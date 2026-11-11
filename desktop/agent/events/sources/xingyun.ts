import { docGet, docList, docPut } from '../../shared/docs.js'
import { listUsers } from '../../auth/users.js'
import { broadcast } from '../../jarvis/sse.js'
import { updateTask } from '../../task/manager.js'
import { abortTask } from '../../jarvis/action-dispatcher.js'
import { unsubscribeTaskEverywhere } from '../../a2a/threads.js'
import { enqueueBackgroundMessage, noopWriter } from '../../jarvis/orchestrator.js'
import type { TaskOrigin } from '../../jarvis/task-origin.js'
import { jdmePlain, sendJdMe, createJdMeGroup, sendJdMeGroup, getJdMeOwnerErp, getJdMeOwnerNickname } from './jdsme.js'
import { XingyunClient, type XingyunCard } from './xingyun-client.js'
import type { EventSink, EventSourceDef, JarvisEvent } from '../types.js'
import { createHash } from 'node:crypto'
import { addStage, setOutcome, startTrace } from '../../jarvis/message-trace.js'

/**
 * 行云需求源(superagent-v2 P5,docs/superagent-design-v2.md):
 *
 * 车道A:行云卡片 = 现成 Mandate(存在即授权,免评估直 accept)。
 *   轮询迭代工作项 → 新卡片/状态流转 → Trigger(线程 `xingyun:card:<id>`)→
 *   实例配置 approval: 'auto' → 直接以需求卡为授权建任务(think 带 mandate 标注);
 *   'approval' → 进审批队列(PendingApproval),Sir 批准后才建任务,拒绝则记录可审计。
 * 卡片关闭(code=7) → 订阅该卡的任务自动收尾(cancelled,原因=需求卡关闭)。
 *
 * 状态全在文档表:
 *   kind='xingyun-cursor'  key='state'   {seenCards:{id:statusHash}}
 *   kind='approval'        key=审批id    {status:pending|approved|rejected,...}
 *   kind='source-instance' key='xingyun' {enabled,sprintId,approval,pollMin}
 * 卡片评论同步 v2。
 */

const client = new XingyunClient()

export interface XingyunInstanceConfig {
  enabled: boolean
  sprintId: string
  /** auto = 需求卡即授权直派;approval = 需 Sir 审批后才派 */
  approval: 'auto' | 'approval'
  pollMin: number
}

const DEFAULTS: XingyunInstanceConfig = { enabled: true, sprintId: '', approval: 'approval', pollMin: 5 }

export async function getXingyunInstance(userId: string): Promise<XingyunInstanceConfig> {
  const doc = await docGet<Partial<XingyunInstanceConfig>>(userId, 'source-instance', 'xingyun')
  if (!doc) return { ...DEFAULTS }
  return {
    enabled: typeof doc.enabled === 'boolean' ? doc.enabled : DEFAULTS.enabled,
    sprintId: String(doc.sprintId ?? ''),
    approval: doc.approval === 'auto' ? 'auto' : 'approval',
    pollMin: Number.isFinite(Number(doc.pollMin)) && Number(doc.pollMin) > 0 ? Number(doc.pollMin) : DEFAULTS.pollMin,
  }
}

export async function saveXingyunInstance(userId: string, patch: Partial<XingyunInstanceConfig>): Promise<XingyunInstanceConfig> {
  const merged = { ...(await getXingyunInstance(userId)), ...patch }
  await docPut(userId, 'source-instance', 'xingyun', merged)
  return merged
}

/** Policy 版本(P5):来源实例配置的哈希 —— 审批/任务记录的依据版本,可审计 */
export async function computePolicyVersion(userId: string): Promise<string> {
  const x = await getXingyunInstance(userId)
  const hash = createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 8)
  return `pv-${hash}`
}

// ── 审批队列 ──

export interface ApprovalRecord {
  id: string
  kind: 'xingyun_card'
  cardId: string
  title: string
  url: string
  creator: string
  /** 创建人 ERP —— 批准并选择拉群时要拉他进群 */
  creatorErp?: string
  status: 'pending' | 'approved' | 'rejected'
  /** 批准时是否选择拉群(仅 approved 有意义) */
  withGroup?: boolean
  at: number
  decidedAt?: number
  note?: string
  policyVersion: string
}

export async function createApproval(userId: string, rec: Omit<ApprovalRecord, 'id' | 'status' | 'at'>): Promise<ApprovalRecord> {
  const id = `ap-${rec.cardId}`
  const existing = await docGet<ApprovalRecord>(userId, 'approval', id)
  if (existing && existing.status === 'pending') return existing   // 幂等:同卡只挂一单
  const approval: ApprovalRecord = { ...rec, id, status: 'pending', at: Date.now() }
  await docPut(userId, 'approval', id, approval)
  return approval
}

export async function listApprovals(userId: string, status?: ApprovalRecord['status']): Promise<ApprovalRecord[]> {
  const all = await docList<ApprovalRecord>(userId, 'approval', '', 100)
  const list = all.map(i => i.data).sort((a, b) => b.at - a.at)
  return status ? list.filter(a => a.status === status) : list
}

/** 批准/驳回。批准 → 以审批记录为授权依据建任务;驳回 → 记录理由可审计。
 *  withGroup 由 Sir 在批准时选择(UI 两个按钮):true 才建京ME 对接群并拉创建人。 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  action: 'approve' | 'reject',
  note?: string,
  opts?: { withGroup?: boolean },
): Promise<ApprovalRecord | null> {
  const rec = await docGet<ApprovalRecord>(userId, 'approval', approvalId)
  if (!rec || rec.status !== 'pending') return rec ?? null
  const withGroup = action === 'approve' && opts?.withGroup === true
  const decided: ApprovalRecord = {
    ...rec, status: action === 'approve' ? 'approved' : 'rejected', decidedAt: Date.now(), note,
    ...(action === 'approve' ? { withGroup } : {}),
  }
  await docPut(userId, 'approval', approvalId, decided)
  if (action === 'approve') {
    await dispatchCardTask(userId, {
      cardId: rec.cardId, title: rec.title, url: rec.url, creator: rec.creator, creatorErp: rec.creatorErp,
    }, `审批单 ${approvalId}`, { createGroup: withGroup })
  }
  broadcast('approval_updated', JSON.stringify({ id: approvalId, status: decided.status }), userId, 'event-reply')
  return decided
}

/** 以需求卡为 Mandate 建任务:走 Jarvis 完整 think(它拆解/派小弟),来源标注行云卡。 */
async function dispatchCardTask(
  userId: string,
  card: { cardId: string; title: string; url: string; creator: string; creatorErp?: string },
  basis: string,
  opts: { createGroup?: boolean } = {},
): Promise<void> {
  let detail = ''
  try {
    const d = await client.cardDetail(card.cardId)
    detail = d.desc ? `\n\n【需求描述】\n${d.desc.slice(0, 2000)}` : ''
  } catch { /* 详情拉不到就只给标题 */ }

  // 对接群(与 task-hud 同款)只在 Sir 批准时明确选择"拉群"才建:
  // 建群会拉真实同事进群,属于对外动作,默认不做。成功后任务来源切到该群 ——
  // 完成汇报按现有 JDME 同步链路自动回到群里(开场白承诺的"进展同步")。
  // 建群失败(无凭证/无权限)只降级为不拉群,绝不阻塞派单。
  let origin: TaskOrigin = {
    kind: 'dm', chatId: card.cardId, chatName: `行云卡 ${card.title}`, channel: 'xingyun',
  }
  let groupNote = ''
  if (opts.createGroup) {
    try {
      const creatorErp = String(card.creatorErp ?? '').trim() || await lookupCreatorErp(card.cardId).catch(() => '')
      if (!creatorErp) throw new Error('卡片没有创建人 ERP,无法拉群')
      const clipped = card.title.length > 24 ? `${card.title.slice(0, 24)}…` : card.title
      const groupName = `${clipped} · 行云`
      const created = await createJdMeGroup({
        name: groupName,
        ownerErp: getJdMeOwnerErp(),
        members: [creatorErp],
        intro: 'Jarvis 自动创建的对接群',
        uniqueKey: `xingyun-${card.cardId}`,
      })
      if (!created.groupId) throw new Error('建群接口未返回 groupId')
      await sendJdMeGroup(
        created.groupId,
        `@${card.creator} 你好，我是${getJdMeOwnerNickname()}的助手，由我来对接你本次的需求。后续澄清和进展都会在这个群里同步。\n行云卡片：${card.url}`,
        [{ app: 'ee', pin: creatorErp, nickname: card.creator }],
      ).catch(err => console.error(`[xingyun] 建群成功但开场消息发送失败: ${err instanceof Error ? err.message : err}`))
      origin = { kind: 'group', chatId: created.groupId, chatName: groupName, channel: 'xingyun' }
      groupNote = `\n\n【对接群】已建京ME 群「${groupName}」(${created.groupId})并拉入创建人 ${card.creator}(${creatorErp})。完成后的复盘汇报会自动同步到该群。`
      console.log(`[xingyun] 已建对接群: ${groupName} (${created.groupId}) ← 卡片 ${card.cardId}`)
      broadcast('user_message', JSON.stringify({ text: `【行云】已为需求卡「${clipped}」创建对接群「${groupName}」,拉入 ${card.creator}。` }), userId, 'event-reply')
    } catch (err) {
      console.error(`[xingyun] 建对接群失败(降级为卡片直接派单): ${err instanceof Error ? err.message : err}`)
    }
  }

  const labeled = `【行云需求卡(已授权:${basis})】\n标题:${card.title}\n链接:${card.url}\n创建人:${card.creator}${detail}${groupNote}\n\n(这是行云上的正式需求,来源即授权依据。请评估后 create_task 派小弟执行,拆解要贴合需求描述;完成后汇报会登记到该需求卡,不在京ME回信。${origin.kind === 'group' ? '任务来源已绑定对接群,复盘会同步回群。' : ''})`
  enqueueBackgroundMessage(userId, labeled, noopWriter, origin)
  broadcast('user_message', JSON.stringify({ text: labeled, origin: { kind: origin.kind, chatName: origin.chatName, channel: 'xingyun' } }), userId, 'event-reply')
}

/** 审批记录里没有 creatorErp 的旧单兜底:现拉一次迭代卡列表,按 id 找创建人。 */
async function lookupCreatorErp(cardId: string): Promise<string> {
  const cfg = await getXingyunInstance(ownerId)
  if (!cfg.sprintId) return ''
  const cards = await client.listSprintCards(cfg.sprintId)
  return String(cards.find(c => String(c.id) === String(cardId))?.creatorErp ?? '')
}

/** 卡片关闭 → 订阅该卡的任务自动收尾(P5:bindThread + threadClosed 语义) */
export async function closeTasksForCard(userId: string, cardId: string): Promise<string[]> {
  const subs = await docList<{ taskId: string }>(userId, 'subscription', `xingyun:card:${cardId}:`)
  const closed: string[] = []
  for (const sub of subs) {
    try {
      await updateTask(userId, sub.data.taskId, { status: 'cancelled' })
      abortTask(sub.data.taskId)
      await unsubscribeTaskEverywhere(userId, sub.data.taskId)
      closed.push(sub.data.taskId)
    } catch { /* 单个收尾失败不影响其余 */ }
  }
  return closed
}

// ── 源实现(轮询) ──

let stopped = false
let ownerId = 'system'
let lastPollAt = 0
let startedFlag = false

async function resolveOwner(): Promise<void> {
  try {
    const users = await listUsers()
    ownerId = users[0]?.id ?? 'system'
  } catch { ownerId = 'system' }
}

interface SourceState { seenCards: Record<string, string> }

async function loadState(): Promise<SourceState> {
  return (await docGet<SourceState>(ownerId, 'xingyun-cursor', 'state')) ?? { seenCards: {} }
}

/** 签名 = 状态码#相关人(排序)。人员变化(如被指派给我)也能被识别为变更。 */
function cardSignature(c: XingyunCard): string {
  return `${c.status.code}#${(c.people ?? []).slice().sort().join(',')}`
}

function signatureStatus(sig: string): number {
  return Number(String(sig).split('#')[0]) || 0
}

function signaturePeople(sig: string): string[] {
  const raw = String(sig).split('#')[1] ?? ''
  return raw ? raw.split(',').filter(Boolean) : []
}

/**
 * 归属过滤:只有 Sir 本人出现在「任务受理人/研发主责/测试主责/关注人/协作者/评审人」
 * 里的卡才进流程,别人的活不打扰(用户明确要求)。列表接口只有负责人/协作者/关注人,
 * 受理人/测试主责等要拉一次详情补查 —— 只对「新出现的卡」做,正常轮询零额外请求。
 */
async function isCardMine(card: XingyunCard): Promise<boolean> {
  const me = getJdMeOwnerErp()
  if (!me) return true // 未配置主人 → 不筛选,保持旧行为
  if ((card.people ?? []).includes(me)) return true
  try {
    return (await client.cardPeople(card.id)).includes(me)
  } catch {
    return false
  }
}

export function createXingyunSource(): EventSourceDef {
  return {
    id: 'xingyun',
    start(ctx) {
      void (async () => {
        // 先解析配置所有者:source-instance/审批/游标都按 ownerId 存,不解析会以 'system'
        // 查不到用户配置,静默跳过(此前 ensureXingyunOwner 定义了却没人调用,源从未启动)。
        await ensureXingyunOwner()
        const cfg = await getXingyunInstance(ownerId)
        if (!cfg.enabled || !cfg.sprintId) {
          console.log('[xingyun] 未启用或未配置 sprintId(配置页→事件源),源跳过')
          return
        }
        let state = await loadState()
        console.log(`[xingyun] 事件源已启动:sprint=${cfg.sprintId},审批=${cfg.approval},轮询=${cfg.pollMin}分钟`)
        startedFlag = true
        // 首次接入基线(同 jdsme 游标对齐语义):库里没有任何看到的卡 = 第一次跑(或旧格式签名升级),
        // 把当前迭代的存量卡全部记为已见、不回放 —— 否则审批模式下一次灌 100+ 条
        // 历史卡(全是已完成的老单),把审批队列和聊天流冲垮。之后新建/状态变更的卡才进流程。
        let firstRun = Object.keys(state.seenCards).length === 0
          || Object.values(state.seenCards).some(v => typeof v === 'string' && !v.includes('#'))
        while (!stopped) {
          try {
            const cards = await client.listSprintCards(cfg.sprintId)
            lastPollAt = Date.now()
            if (firstRun) {
              for (const card of cards) state.seenCards[card.id] = cardSignature(card)
              await docPut(ownerId, 'xingyun-cursor', 'state', state)
              firstRun = false
              console.log(`[xingyun] 首次接入:${cards.length} 张存量卡记为基线(不回放),之后只看新建/状态变更`)
              await new Promise(r => setTimeout(r, cfg.pollMin * 60_000))
              continue
            }
            for (const card of cards) {
              const sig = cardSignature(card)
              const prev = state.seenCards[card.id]
              if (prev === undefined) {
                // 新卡片:先做归属过滤(只处理有我的卡)
                if (await isCardMine(card)) {
                  await docPut(ownerId, 'thread', `xingyun:card:${card.id}`, { label: card.title, createdAt: Date.now() })
                  const ev: JarvisEvent = {
                    id: `xy-${card.id}-${Date.now()}`,
                    source: 'xingyun', type: 'xingyun_card', userId: ownerId,
                    payload: { card, approval: cfg.approval, policyVersion: await computePolicyVersion(ownerId) },
                    receivedAt: Date.now(),
                  }
                  ctx.emit(ev)
                } else {
                  console.log(`[xingyun] 跳过非本人卡(受理人/主责/关注人均无我): ${card.title.slice(0, 40)}`)
                }
              } else if (prev !== sig) {
                const me = getJdMeOwnerErp()
                if (signatureStatus(sig) === 7) {
                  // 状态流转 → 关闭(7=finished,task-hud 同语义);关闭事件对所有卡发,无任务时是空操作
                  const ev: JarvisEvent = {
                    id: `xy-close-${card.id}-${Date.now()}`, source: 'xingyun', type: 'xingyun_card_closed',
                    userId: ownerId, payload: { card }, receivedAt: Date.now(),
                  }
                  ctx.emit(ev)
                } else if (me && !signaturePeople(prev).includes(me) && await isCardMine(card)) {
                  // 卡片被指派给我(负责人/主责/关注人变化)→ 当作新卡进流程
                  await docPut(ownerId, 'thread', `xingyun:card:${card.id}`, { label: card.title, createdAt: Date.now() })
                  const ev: JarvisEvent = {
                    id: `xy-${card.id}-${Date.now()}`, source: 'xingyun', type: 'xingyun_card',
                    userId: ownerId,
                    payload: { card, approval: cfg.approval, policyVersion: await computePolicyVersion(ownerId) },
                    receivedAt: Date.now(),
                  }
                  ctx.emit(ev)
                  console.log(`[xingyun] 卡片指派给我,进入流程: ${card.title.slice(0, 40)}`)
                }
              }
              state.seenCards[card.id] = sig
            }
            // 收尾:seen 里已不在看板的卡片不删(需求可能暂离迭代),仅保留
            await docPut(ownerId, 'xingyun-cursor', 'state', state)
          } catch (err) {
            console.error(`[xingyun] 轮询失败: ${err instanceof Error ? err.message : err}`)
          }
          await new Promise(r => setTimeout(r, cfg.pollMin * 60_000))
        }
      })()
    },
    stop() { stopped = true },
  }
}

/** router 分发:xingyun 事件处理(auto 直派 / approval 进队列 / closed 收尾) */
export async function handleXingyunEvent(ev: JarvisEvent): Promise<void> {
  const userId = ev.userId
  if (ev.type === 'xingyun_card') {
    const { card, approval, policyVersion } = ev.payload as { card: XingyunCard; approval: 'auto' | 'approval'; policyVersion: string }
    const tid = `xy-${card.id}`
    startTrace(userId, tid, { channel: 'xingyun', sender: card.creatorName || card.creatorErp, textPreview: card.title })
    addStage(tid, '收到 · 行云需求卡(卡片即授权)', { detail: `policy ${policyVersion}`, mech: approval === 'auto' ? '审批-auto' : '审批' })
    if (approval === 'auto') {
      await dispatchCardTask(userId, {
        cardId: card.id, title: card.title, url: card.url,
        creator: card.creatorName || card.creatorErp, creatorErp: card.creatorErp,
      }, `行云卡 ${card.cardCode || card.id},policy ${policyVersion}`)
      console.log(`[xingyun] 需求卡直派(auto): ${card.title}`)
      setOutcome(tid, 'dispatched', { detail: '卡片即授权直派' })
      return
    }
    const rec = await createApproval(userId, {
      kind: 'xingyun_card', cardId: card.id, title: card.title, url: card.url,
      creator: card.creatorName || card.creatorErp, creatorErp: card.creatorErp, policyVersion,
    })
    void rec
    addStage(tid, '进审批队列,等待 Sir 处理', { detail: `审批单 ${rec.id}` })
    const note = `【待审批】行云需求卡「${card.title}」\n创建人:${rec.creator}\n审批单:${rec.id}(policy ${policyVersion})\n在「运行」页或配置页→事件源处理:批准并拉群(建京ME 对接群拉创建人)/ 仅批准 / 驳回。`
    broadcast('user_message', JSON.stringify({ text: note }), userId, 'event-reply')
    console.log(`[xingyun] 需求卡进审批队列: ${card.title}(${rec.id})`)
    // 京ME 推给主人(轻提醒);ownerErp 未配置时静默跳过
    try {
      const erp = getJdMeOwnerErp()
      if (erp) await sendJdMe('dm', erp, jdmePlain(note, 300))
    } catch { /* 京ME不可用就只走 web */ }
    return
  }
  if (ev.type === 'xingyun_card_closed') {
    const { card } = ev.payload as { card: XingyunCard }
    const closed = await closeTasksForCard(userId, card.id)
    console.log(`[xingyun] 需求卡关闭,收尾任务: ${card.title} → ${closed.length ? closed.join(',') : '无绑定任务'}`)
    if (closed.length) {
      broadcast('user_message', JSON.stringify({ text: `【行云】需求卡「${card.title}」已关闭,自动收尾任务 ${closed.length} 个。` }), userId, 'event-reply')
    }
    // 清审批队列里的 pending(需求都没了)
    const ap = await docGet<ApprovalRecord>(userId, 'approval', `ap-${card.id}`)
    if (ap && ap.status === 'pending') {
      await docPut(userId, 'approval', ap.id, { ...ap, status: 'rejected', decidedAt: Date.now(), note: '需求卡已关闭' })
    }
  }
}

/** 运行信息(事件源心跳) */
export function getXingyunRuntimeInfo(): { running: boolean; lastPollAt: number } {
  return { running: startedFlag && !stopped, lastPollAt }
}

export const xingyunSink: EventSink = {
  id: 'xingyun',
  async reply() { /* 行云无回写通道 v1:汇报走任务复盘,不回写卡片 */ },
}

let ownerResolved = false
export async function ensureXingyunOwner(): Promise<void> {
  if (ownerResolved) return
  await resolveOwner()
  ownerResolved = true
}
