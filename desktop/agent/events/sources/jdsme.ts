import { readFile } from 'node:fs/promises'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { docGet, docPut } from '../../shared/docs.js'
import { loadJdMeConfig, JdMeClient, type JdMeConfig } from './jdsme-client.js'
import { gateJdmeMessage, isGroupAllowed } from './jdsme-filter.js'
import { getJdmeInstance } from './registry.js'
import { listUsers } from '../../auth/users.js'
import { getSettings } from '../../jarvis/persona.js'
import type { EventSink, EventSourceDef, JarvisEvent } from '../types.js'

/**
 * 京ME 事件源(M3):长轮询事件服务 → 标准化 JarvisEvent(fastPath 在此完成)。
 *
 * 产品规则(已与 Sir 确认):
 *   - 私聊:一律处理(等同对话)
 *   - 群聊:必须 @机器人；配置了群白名单时只放行白名单群，未配置则放行全部群
 *   - 噪音分诊在 router 的 slowPath 做;这里只做白名单 / 去重 / @检测 / 游标
 *
 * 无凭证(找不到 task-hud 的 jdsme.json)时自动停用,不报错。凭证与 task-hud 共用一份。
 */

const STATE_VERSION = 1
const statePath = join(process.cwd(), 'data', 'jdsme-source-state.json')
const whitelistPath = join(process.cwd(), 'data', 'jarvis-events.json')

interface SourceState {
  version: number
  cursor: number
  /** 会话内已见 msgId(防重放),每会话封顶 */
  seen: Record<string, string[]>
}

let client: JdMeClient | null = null
let ownerErp = ''
let config: JdMeConfig | null = null
let ownerId = 'system'
let stopped = false
let state: SourceState = { version: STATE_VERSION, cursor: 0, seen: {} }
let fresh = true
let whitelistedGroups: string[] = []
// P4:实例配置(source-instance 文档)——准入模式 + 白名单接管开关
let admission: 'explicit' | 'candidates' | 'ignore' = 'explicit'
let hasInstance = false

/** 事件归属用户:单机单主人,取第一个注册用户(多用户绑定后置) */
async function resolveOwner(): Promise<void> {
  try {
    const users = await listUsers()
    ownerId = users[0]?.id ?? 'system'
  } catch {
    ownerId = 'system'
  }
}

async function loadState(): Promise<void> {
  // 游标状态迁入通用文档表(superagent-v2 P0):kind='jdsme-cursor',按归属用户隔离。
  // 首次读空时尝试旧 JSON 侧车一次性导入,导入后改名留档。
  try {
    const doc = await docGet<SourceState>(ownerId, 'jdsme-cursor', 'state')
    if (doc?.version === STATE_VERSION) {
      state = doc
      fresh = false
      return
    }
  } catch (err) {
    console.error(`[jdsme] 游标文档表读取失败(走旧文件): ${err instanceof Error ? err.message : err}`)
  }
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'))
    if (parsed?.version === STATE_VERSION) {
      state = parsed
      fresh = false
      await persistState()
      await rename(statePath, `${statePath}.migrated`).catch(() => {})
      console.log('[jdsme] 旧游标文件已迁入文档表')
    }
  } catch { /* 首次运行无状态文件 */ }
}

async function persistState(): Promise<void> {
  try {
    await docPut(ownerId, 'jdsme-cursor', 'state', state)
  } catch { /* 游标落库失败不致命:下次轮询按水位校正 */ }
}

async function loadWhitelist(): Promise<void> {
  // 优先配置界面(data/persona/settings.json 的 events.jdsmeGroups);没配则回退旧版 jarvis-events.json。
  try {
    const groups = getSettings().events.jdsmeGroups
    if (groups.length > 0) {
      whitelistedGroups = groups
      console.log(`[jdsme] 群白名单 ${groups.length} 个;仅放行这些群`)
      return
    }
  } catch { /* settings 读失败走旧文件 */ }
  try {
    const parsed = JSON.parse(await readFile(whitelistPath, 'utf8'))
    whitelistedGroups = Array.isArray(parsed?.groups) ? parsed.groups.map(String) : []
  } catch {
    whitelistedGroups = []
  }
  if (whitelistedGroups.length > 0) {
    console.log(`[jdsme] 群白名单 ${whitelistedGroups.length} 个(来自 jarvis-events.json);仅放行这些群`)
  } else {
    console.log('[jdsme] 未配置群白名单 → 放行全部群(仍要求 @机器人);私聊正常')
  }
}

/** 报文 → JarvisEvent(fastPath:类型过滤 / @检测 / 白名单 / 去重);不合规返回 null */
function normalize(event: any): JarvisEvent | null {
  if (!client || !config) return null
  const payload = event?.event ?? {}
  if (payload?.eventType !== 'chat_message') return null
  const body = payload.event ?? {}
  const robotPin = payload.robotPin
  const sender = String(body.sender?.pin ?? '').trim()
  if (!sender || sender === robotPin) return null

  const groupId = String(body.groupId ?? '').trim()
  const chatType = String(body.chatType ?? '')
  let kind: 'group' | 'dm'
  let chatId: string
  let chatName: string
  if (groupId) {
    kind = 'group'
    chatId = groupId
    chatName = String(body.groupName ?? body.groupTitle ?? '').trim() || `群 ${groupId}`
    const inner = body.body ?? {}
    const atUsers = Array.isArray(inner.atUsers) ? inner.atUsers : []
    const botName = config.bot?.displayName ?? ''
    const atRobot = atUsers.length
      ? atUsers.some((u: any) => u?.pin === robotPin)
      : Boolean(botName) && String(inner.content ?? '').includes(`@${botName}`)
    // P4 Gate:结构化判定(白名单 + 准入表 + @检测),代码层 Fast Path
    const verdict = gateJdmeMessage({
      isDm: false,
      groupAllowed: isGroupAllowed(groupId, whitelistedGroups),
      atRobot,
      admission,
    })
    if (!verdict.pass) {
      // 过滤可观测:静默丢弃排查起来是盲区(验证期教训)
      console.log(`[jdsme] gate 过滤: 「${chatName}」${sender} "${String(inner.content ?? '').slice(0, 40)}" — ${verdict.reason}`)
      return null
    }
    if (verdict.strength === 'inferred') {
      // 候选放行(观察模式):未@的群消息作为候选,交给 slowPath 分诊 + 评估窗口定夺
      console.log(`[jdsme] 候选放行(未@):「${chatName}」${sender}: ${String(inner.content ?? '').slice(0, 60)}`)
    }
  } else {
    if (chatType === '2' || !sender) return null
    kind = 'dm'
    chatId = sender
    chatName = sender
  }

  const content = stripMention(String(body.body?.content ?? ''), payload)
  if (!content) return null

    const msgId = String(body.msgId ?? '').trim() || `seq-${event.seq}`
    const seenKey = `${kind}:${chatId}`
    const seen = state.seen[seenKey] ?? (state.seen[seenKey] = [])
    if (seen.includes(msgId)) return null
    seen.push(msgId)
    if (seen.length > 200) seen.splice(0, seen.length - 200)

    console.log(`[jdsme] 收到 ${kind === 'group' ? '群' : '私聊'}「${chatName}」${sender}: ${content.slice(0, 80)}`)

  return {
    id: `jdsme-${event.seq}-${msgId}`,
    source: 'jdsme',
    type: 'im_message',
    userId: ownerId,
    payload: { kind, chatId, chatName, sender, text: content, msgId },
    raw: event,
    receivedAt: Date.now(),
  }
}

function stripMention(text: string, payload: any): string {
  const body = payload?.event?.body ?? {}
  const names = (body.atUsers ?? [])
    .filter((u: any) => u?.pin === payload?.robotPin)
    .map((u: any) => u?.nickname)
    .filter(Boolean)
  let output = String(text ?? '')
  for (const name of names) {
    output = output.replace(new RegExp(`^\\s*@\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`), '')
    output = output.replace(new RegExp(`\\s+@\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
  }
  // 兜底:@ 与昵称之间夹特殊空白时,至少去掉开头的 @
  return output.replace(/^\s*@[^\s ]+[\s ]+/, '').trim()
}

/** 京ME 信道规范:短平快、纯文本、去 markdown 符号、按 maxLen 截断(sink/工具/任务同步共用) */
export function jdmePlain(text: string, maxLen = 500): string {
  return String(text ?? '')
    .replace(/[*_`#>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, maxLen)
}

/** 京ME 回复 sink:京ME 信道规范 —— 短平快、纯文本、去 markdown 符号 */
export const jdsmeSink: EventSink = {
  id: 'jdsme',
  async reply(_userId: string, ev: JarvisEvent, text: string): Promise<void> {
    if (!client) return
    const payload = ev.payload as { kind: 'group' | 'dm'; chatId: string; chatName: string }
    const plain = jdmePlain(text)
    console.log(`[jdsme] 回复 ${payload.kind === 'group' ? '群' : '私聊'}「${payload.chatName}」: ${plain.slice(0, 80)}`)
    if (payload.kind === 'group') await client.sendGroup(payload.chatId, plain)
    else await client.sendPersonal(payload.chatId, plain)
  },
}

/**
 * 主动发京ME 消息(工具 send_jdme 用)。事件源未启用(无凭证)时返回 false。
 * chatId:群号(群聊)或对方 erp(私聊),与事件 payload 同一套标识。
 */
/** JoySpace 文档出口(P6 验证期):markdown 产物 → 在线文档,返回 url 供京ME发链接。 */
export async function createJoyDoc(input: { title: string; folderName?: string; markdown: string; members?: string[] }) {
  if (!client) throw new Error('京ME未启用(JoySpace 出口依赖同一服务)')
  return client.createJoyDoc(input)
}

export async function sendJdMe(
  kind: 'group' | 'dm',
  chatId: string,
  text: string,
): Promise<boolean> {
  if (!client) return false
  const plain = jdmePlain(text)
  if (kind === 'group') await client.sendGroup(chatId, plain)
  else await client.sendPersonal(chatId, plain)
  console.log(`[jdsme] 主动发送 → ${kind === 'group' ? '群' : '私聊'}「${chatId}」: ${plain.slice(0, 80)}`)
  return true
}

/**
 * 初始化并返回京ME事件源;无凭证返回 null(事件系统跳过它)。
 */
/** 主人 ERP(router 判定消息说话人身份用);事件源未启用/未配置时为空串。 */
export function getJdMeOwnerErp(): string {
  return ownerErp
}

export async function initJdMeSource(): Promise<EventSourceDef | null> {
  config = await loadJdMeConfig()
  if (!config) {
    console.log('[jdsme] 未找到京ME凭证(jdsme.json),事件源停用')
    return null
  }
  client = new JdMeClient(config)
  await resolveOwner()
  await loadState()
  await loadWhitelist()

  // P4:实例配置(文档表 source-instance)优先于 settings/旧白名单文件
  try {
    const inst = await getJdmeInstance(ownerId)
    if (!inst.enabled) {
      console.log('[jdsme] 事件源已在配置页停用(source-instance.enabled=false)')
      return null
    }
    admission = inst.admission
    hasInstance = true
    if (inst.groups.length > 0 || admission !== 'explicit') {
      whitelistedGroups = inst.groups
      console.log(`[jdsme] 实例配置生效:准入=${inst.admission},白名单群 ${inst.groups.length} 个`)
    }
  } catch { /* 实例配置读不到 → 维持 settings/旧文件行为 */ }

  /** 主人 ERP(router 判定消息说话人身份用);未配置 ownerErp 时为空。 */
  ownerErp = String(config.ownerErp ?? '').trim()

  return {
    id: 'jdsme',
    start(ctx) {
      void (async () => {
        if (!client || !config) return
        // 游标对齐:首次接入对到服务端最新,历史不回放;另外检测「游标超前」——
        // 京ME 服务换代(如迁到新域名)后 seq 从 0 重计,旧游标会让长轮询永远返回空,
        // 静默收不到消息。此时重置到服务端水位,只向前对齐(修法同 task-hud 4c77648)。
        try {
          const serverLastSeq = await client.fetchLastSeq()
          if (fresh) {
            state.cursor = serverLastSeq
            fresh = false
            await persistState()
          } else if (state.cursor > serverLastSeq) {
            console.log(`[jdsme] 本地游标 ${state.cursor} 超前于服务端水位 ${serverLastSeq},判定为 server 换代/游标失配,重置游标`)
            state.cursor = serverLastSeq
            await persistState()
          }
        } catch { /* 下轮再对 */ }
        console.log(`[jdsme] 事件源已启动(profile=${config.profile},游标=${state.cursor},${whitelistedGroups.length > 0 ? `白名单群 ${whitelistedGroups.length} 个` : '未设白名单 → 放行全部群'})`)

        let lastError = ''
        while (!stopped) {
          try {
            const data = await client.fetchEvents(state.cursor, { wait: config.pollSeconds ?? 25 })
            if (lastError) {
              console.log('[jdsme] 轮询恢复')
              lastError = ''
            }
            for (const event of data.events ?? []) {
              state.cursor = Math.max(state.cursor, Number(event.seq) || 0)
              const ev = normalize(event)
              if (ev) ctx.emit(ev)
            }
            await persistState()
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err)
            console.error(`[jdsme] 轮询失败,稍后重试: ${lastError}`)
            await new Promise(r => setTimeout(r, 5_000))
            if (stopped) break
          }
        }
      })()
    },
    stop() {
      stopped = true
    },
  }
}
