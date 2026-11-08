import { docDelete, docList, docPut } from '../shared/docs.js'

/**
 * 消息处理流水采集(运行面板数据源,docs/superagent-design-v2.md 队列面板一期):
 *
 * 每条进来的消息一条 trace(kind='mtrace',key=消息id),沿处理链埋点:
 *   收到/gate → Trigger 幂等 → 订阅命中|分诊 → 排队 → think 上下文组装 → 决策 → 去向
 * 抽屉里"上下文组装条形图"来自 setContext(brain 的分区尺寸),"机制命中"来自各阶段
 * 携带的 mech 标记(前端把已知机制清单减去命中的就是"未触发")。
 *
 * 写入策略:内存累积,关键节点 flush(intake 后 / think 完成 / 丢弃)——绝不阻塞主链路,
 * flush 失败只丢流水。保留最近 300 条(每 20 次 flush 触发一次裁剪)。
 * 全局计数器(放行/过滤/寒暄/直通…)供事件源心跳读取,自启动起累计。
 */

export type TraceChannel = 'jdsme-group' | 'jdsme-dm' | 'web' | 'xingyun'

export interface TraceStage {
  at: number
  stage: string
  detail?: string
  /** 机制标记:gate-explicit / gate-filter / dedup / 订阅直通 / 寒暄静默 / LLM分诊 / 接单门槛 / handback / 审批 / 记忆检索 … */
  mech?: string
}

export interface MessageTraceData {
  id: string
  userId: string
  at: number
  channel: TraceChannel
  chatName?: string
  sender?: string
  textPreview: string
  stages: TraceStage[]
  context?: Record<string, number>
  contextTotal?: number
  outcome?: string
  costMs?: number
}

const active = new Map<string, MessageTraceData>()
const MAX_ACTIVE = 200
const MAX_STORED = 300
const FLUSH_LIMIT = 120
let flushCount = 0

// ── 全局计数器(事件源心跳用,自启动累计) ──
const counters: Record<string, number> = {}

export function bumpCounter(key: string, by = 1): void {
  counters[key] = (counters[key] ?? 0) + by
}

export function getCounters(): Record<string, number> {
  return { ...counters }
}

// ── 采集 API(全部同步,flush 异步不阻塞) ──

export function startTrace(userId: string, id: string, meta: {
  channel: TraceChannel
  chatName?: string
  sender?: string
  textPreview: string
}): void {
  active.set(id, {
    id, userId, at: Date.now(), ...meta,
    textPreview: meta.textPreview.slice(0, 120),
    stages: [],
  })
  if (active.size > MAX_ACTIVE) {
    const oldest = [...active.keys()][0]
    active.delete(oldest)
  }
}

export function addStage(id: string, stage: string, opts?: { detail?: string; mech?: string }): void {
  const t = active.get(id)
  if (!t) return
  t.stages.push({ at: Date.now(), stage, ...(opts?.detail ? { detail: opts.detail.slice(0, 200) } : {}), ...(opts?.mech ? { mech: opts.mech } : {}) })
}

export function setContext(id: string, sections: Record<string, number>, total: number): void {
  const t = active.get(id)
  if (!t) return
  t.context = sections
  t.contextTotal = total
}

export function setOutcome(id: string, outcome: string, opts?: { costMs?: number; detail?: string }): void {
  const t = active.get(id)
  if (!t) return
  t.outcome = outcome
  if (opts?.costMs !== undefined) t.costMs = opts.costMs
  if (opts?.detail) t.stages.push({ at: Date.now(), stage: outcome, detail: opts.detail.slice(0, 200) })
  void flushTrace(id)
}

/** 落盘一条 trace(内存移除 → 写文档表;每 20 次触发一次该用户滚动裁剪)。 */
export async function flushTrace(id: string): Promise<void> {
  const t = active.get(id)
  if (!t) return
  active.delete(id)
  try {
    await docPut(t.userId, 'mtrace', t.id, t)
    flushCount++
    if (flushCount % 20 === 0) await trimTracesFor(t.userId)
  } catch { /* 流水落盘失败不致命 */ }
}

/** 滚动裁剪:每用户只留最近 keep 条。 */
export async function trimTracesFor(userId: string, keep = MAX_STORED): Promise<void> {
  const all = await docList(userId, 'mtrace', '', keep + 60)
  if (all.length <= keep) return
  for (const item of all.slice(keep)) {
    await docDelete(userId, 'mtrace', item.key)
  }
}
