import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadJdMeConfig, JdMeClient, type JdMeConfig } from './jdsme-client.js'
import { listUsers } from '../../auth/users.js'
import type { EventSink, EventSourceDef, JarvisEvent } from '../types.js'

/**
 * 京ME 事件源(M3):长轮询事件服务 → 标准化 JarvisEvent(fastPath 在此完成)。
 *
 * 产品规则(已与 Sir 确认):
 *   - 私聊:一律处理(等同对话)
 *   - 群聊:必须 @机器人,且群在白名单(data/jarvis-events.json 的 groups)里,否则完全静默
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
let config: JdMeConfig | null = null
let ownerId = 'system'
let stopped = false
let state: SourceState = { version: STATE_VERSION, cursor: 0, seen: {} }
let fresh = true
let whitelistedGroups: string[] = []

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
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'))
    if (parsed?.version === STATE_VERSION) {
      state = parsed
      fresh = false
    }
  } catch { /* 首次运行无状态文件 */ }
}

async function persistState(): Promise<void> {
  try {
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch { /* 状态盘写失败不致命 */ }
}

async function loadWhitelist(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(whitelistPath, 'utf8'))
    whitelistedGroups = Array.isArray(parsed?.groups) ? parsed.groups.map(String) : []
  } catch {
    whitelistedGroups = []
  }
  if (whitelistedGroups.length === 0) {
    console.log('[jdsme] 群白名单为空(data/jarvis-events.json → {"groups":["群号"]});群聊将全部静默,私聊正常')
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
    // 群聊双重门槛:白名单 + @机器人(atUsers 优先,正文 "@昵称" 兜底——移植 task-hud 逻辑)
    if (!whitelistedGroups.includes(groupId)) return null
    const inner = body.body ?? {}
    const atUsers = Array.isArray(inner.atUsers) ? inner.atUsers : []
    const botName = config.bot?.displayName ?? ''
    const atRobot = atUsers.length
      ? atUsers.some((u: any) => u?.pin === robotPin)
      : Boolean(botName) && String(inner.content ?? '').includes(`@${botName}`)
    if (!atRobot) return null
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

/** 京ME 回复 sink:京ME 信道规范 —— 短平快、纯文本、去 markdown 符号 */
export const jdsmeSink: EventSink = {
  id: 'jdsme',
  async reply(_userId: string, ev: JarvisEvent, text: string): Promise<void> {
    if (!client) return
    const payload = ev.payload as { kind: 'group' | 'dm'; chatId: string; chatName: string }
    const plain = text
      .replace(/[*_`#>]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 500)
    console.log(`[jdsme] 回复 ${payload.kind === 'group' ? '群' : '私聊'}「${payload.chatName}」: ${plain.slice(0, 80)}`)
    if (payload.kind === 'group') await client.sendGroup(payload.chatId, plain)
    else await client.sendPersonal(payload.chatId, plain)
  },
}

/**
 * 初始化并返回京ME事件源;无凭证返回 null(事件系统跳过它)。
 */
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

  return {
    id: 'jdsme',
    start(ctx) {
      void (async () => {
        if (!client || !config) return
        // 首次接入:游标对齐服务端最新,历史消息不回放
        if (fresh) {
          try {
            state.cursor = await client.fetchLastSeq()
            fresh = false
            await persistState()
          } catch { /* 下轮再对 */ }
        }
        console.log(`[jdsme] 事件源已启动(profile=${config.profile},游标=${state.cursor},白名单群 ${whitelistedGroups.length} 个)`)

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
