import { docGet, docList, docPut } from '../../shared/docs.js'
import { listUsers } from '../../auth/users.js'
import { broadcast } from '../../jarvis/sse.js'
import { updateTask } from '../../task/manager.js'
import { abortTask } from '../../jarvis/action-dispatcher.js'
import { unsubscribeTaskEverywhere } from '../../a2a/threads.js'
import { enqueueBackgroundMessage, noopWriter } from '../../jarvis/orchestrator.js'
import type { TaskOrigin } from '../../jarvis/task-origin.js'
import { jdmePlain, sendJdMe } from './jdsme.js'
import { XingyunClient, type XingyunCard } from './xingyun-client.js'
import type { EventSink, EventSourceDef, JarvisEvent } from '../types.js'
import { createHash } from 'node:crypto'

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
  status: 'pending' | 'approved' | 'rejected'
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

/** 批准/驳回。批准 → 以审批记录为授权依据建任务;驳回 → 记录理由可审计。 */
export async function decideApproval(userId: string, approvalId: string, action: 'approve' | 'reject', note?: string): Promise<ApprovalRecord | null> {
  const rec = await docGet<ApprovalRecord>(userId, 'approval', approvalId)
  if (!rec || rec.status !== 'pending') return rec ?? null
  const decided: ApprovalRecord = { ...rec, status: action === 'approve' ? 'approved' : 'rejected', decidedAt: Date.now(), note }
  await docPut(userId, 'approval', approvalId, decided)
  if (action === 'approve') {
    await dispatchCardTask(userId, {
      cardId: rec.cardId, title: rec.title, url: rec.url, creator: rec.creator,
    }, `审批单 ${approvalId}`)
  }
  broadcast('approval_updated', JSON.stringify({ id: approvalId, status: decided.status }), userId, 'event-reply')
  return decided
}

/** 以需求卡为 Mandate 建任务:走 Jarvis 完整 think(它拆解/派小弟),来源标注行云卡。 */
async function dispatchCardTask(userId: string, card: { cardId: string; title: string; url: string; creator: string }, basis: string): Promise<void> {
  let detail = ''
  try {
    const d = await client.cardDetail(card.cardId)
    detail = d.desc ? `\n\n【需求描述】\n${d.desc.slice(0, 2000)}` : ''
  } catch { /* 详情拉不到就只给标题 */ }
  const origin: TaskOrigin = {
    kind: 'dm', chatId: card.cardId, chatName: `行云卡 ${card.title}`, channel: 'xingyun',
  }
  const labeled = `【行云需求卡(已授权:${basis})】\n标题:${card.title}\n链接:${card.url}\n创建人:${card.creator}${detail}\n\n(这是行云上的正式需求,来源即授权依据。请评估后 create_task 派小弟执行,拆解要贴合需求描述;完成后汇报会登记到该需求卡,不在京ME回信。)`
  enqueueBackgroundMessage(userId, labeled, noopWriter, origin)
  broadcast('user_message', JSON.stringify({ text: labeled, origin: { kind: 'dm', chatName: origin.chatName, channel: 'xingyun' } }), userId, 'event-reply')
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

function cardSignature(c: XingyunCard): string {
  return `${c.status.code}`
}

export function createXingyunSource(): EventSourceDef {
  return {
    id: 'xingyun',
    start(ctx) {
      void (async () => {
        const cfg = await getXingyunInstance(ownerId)
        if (!cfg.enabled || !cfg.sprintId) {
          console.log('[xingyun] 未启用或未配置 sprintId(配置页→事件源),源跳过')
          return
        }
        let state = await loadState()
        console.log(`[xingyun] 事件源已启动:sprint=${cfg.sprintId},审批=${cfg.approval},轮询=${cfg.pollMin}分钟`)
        while (!stopped) {
          try {
            const cards = await client.listSprintCards(cfg.sprintId)
            for (const card of cards) {
              const sig = cardSignature(card)
              const prev = state.seenCards[card.id]
              if (prev === undefined) {
                // 新卡片:登记线程 + 按审批模式分派
                await docPut(ownerId, 'thread', `xingyun:card:${card.id}`, { label: card.title, createdAt: Date.now() })
                const ev: JarvisEvent = {
                  id: `xy-${card.id}-${Date.now()}`,
                  source: 'xingyun', type: 'xingyun_card', userId: ownerId,
                  payload: { card, approval: cfg.approval, policyVersion: await computePolicyVersion(ownerId) },
                  receivedAt: Date.now(),
                }
                ctx.emit(ev)
              } else if (prev !== sig && Number(sig) === 7) {
                // 状态流转 → 关闭(7=finished,task-hud 同语义)
                const ev: JarvisEvent = {
                  id: `xy-close-${card.id}-${Date.now()}`,
                  source: 'xingyun', type: 'xingyun_card_closed', userId: ownerId,
                  payload: { card }, receivedAt: Date.now(),
                }
                ctx.emit(ev)
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
    if (approval === 'auto') {
      await dispatchCardTask(userId, {
        cardId: card.id, title: card.title, url: card.url, creator: card.creatorName || card.creatorErp,
      }, `行云卡 ${card.cardCode || card.id},policy ${policyVersion}`)
      console.log(`[xingyun] 需求卡直派(auto): ${card.title}`)
      return
    }
    const rec = await createApproval(userId, {
      kind: 'xingyun_card', cardId: card.id, title: card.title, url: card.url,
      creator: card.creatorName || card.creatorErp, policyVersion,
    })
    void rec
    const note = `【待审批】行云需求卡「${card.title}」\n创建人:${rec.creator}\n审批单:${rec.id}(policy ${policyVersion})\n回复"批准 ${rec.id}"开始执行,或在配置页→事件源→审批队列处理。`
    broadcast('user_message', JSON.stringify({ text: note }), userId, 'event-reply')
    console.log(`[xingyun] 需求卡进审批队列: ${card.title}(${rec.id})`)
    // 京ME 推给主人(轻提醒);ownerErp 未配置时静默跳过
    try {
      const { getJdMeOwnerErp } = await import('./jdsme.js')
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
