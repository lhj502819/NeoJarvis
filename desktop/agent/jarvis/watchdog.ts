import { listUsers } from '../auth/users.js'
import { getActiveTasks, getSubtaskTurns } from '../task/manager.js'
import { bus } from '../a2a/bus.js'
import { broadcast } from './sse.js'
import { pushProactiveMessage } from './proactive.js'
import { getSettings } from './persona.js'

/**
 * Watchdog —— 值班经理(docs/superagent-design.md §2)。
 *
 * 主系统之外的定时巡检:盯所有 running 子任务,发现异常主动向 Sir 报告。
 * L1(只报告)是唯一自动化动作;打断/重派/取消由 Sir 拍板(L2/L3 后续接设置)。
 *
 * 巡检信号(优先级从高到低):
 *   zombie      执行会话已不在(bus 里没注册),任务还挂着 running
 *   idle        超过阈值没有任何新回合/工具调用
 *   overtime    总时长超过上限
 *   repeat_fail 同一子任务累计重试 ≥ 2 次
 *
 * 阈值来源:data/persona/settings.json(热改即生效)> env > 内置默认,见 persona.ts
 */

const ZOMBIE_GRACE_MIN = 2   // 派单后小弟注册前有个空窗,别误报

export type WatchdogSignalKind = 'zombie' | 'idle' | 'overtime' | 'repeat_fail'

export interface WatchdogSignal {
  kind: WatchdogSignalKind
  detail: string
}

export interface SubtaskWatchInput {
  status: string
  startedAt: string
  updatedAt: string
  lastTurnAt: string | null
  hasLiveSession: boolean
  retryCount: number
}

/**
 * 纯函数判定(单测覆盖):给定子任务观测数据,返回首个命中的风险信号;健康返回 null。
 */
export function evaluateSubtaskRisk(
  input: SubtaskWatchInput,
  now: Date,
  thresholds?: { idleMin: number; maxMin: number },
): WatchdogSignal | null {
  const t = thresholds ?? (() => { const w = getSettings().watchdog; return { idleMin: w.idleMin, maxMin: w.maxMin } })()
  if (input.status !== 'running') return null

  const startedMs = Date.parse(input.startedAt)
  const runMin = Number.isFinite(startedMs) ? (now.getTime() - startedMs) / 60_000 : 0

  // 僵尸:派单超过宽限期仍无 live 会话
  if (!input.hasLiveSession && runMin > ZOMBIE_GRACE_MIN) {
    return { kind: 'zombie', detail: `执行会话已不存在(任务挂了 ${Math.floor(runMin)} 分钟)` }
  }

  // 没动静:从未有过回合时按开始时间算,否则按最后一次回合
  const activityAt = input.lastTurnAt ?? input.startedAt
  const activityMs = Date.parse(activityAt)
  if (Number.isFinite(activityMs)) {
    const idleMin = (now.getTime() - activityMs) / 60_000
    if (idleMin > t.idleMin) {
      return { kind: 'idle', detail: `${Math.floor(idleMin)} 分钟没有新进展` }
    }
  }

  // 跑太久
  if (runMin > t.maxMin) {
    return { kind: 'overtime', detail: `已经跑了 ${Math.floor(runMin)} 分钟` }
  }

  // 连环失败
  if (input.retryCount >= getSettings().watchdog.retryFailCount) {
    return { kind: 'repeat_fail', detail: `已重试 ${input.retryCount} 次` }
  }

  return null
}

const SIGNAL_TEXT: Record<WatchdogSignalKind, (ctx: { agentName: string; taskName: string; subtaskId: string; detail: string }) => string> = {
  zombie: c => `${c.agentName} 的「${c.taskName}」会话好像掉线了(${c.detail})。建议我直接重派一份,你说一声就行(子任务 ${c.subtaskId})。`,
  idle: c => `${c.agentName} 的「${c.taskName}」${c.detail}。要我看看吗?可以直接说「催一下 ${c.subtaskId}」或「取消 ${c.subtaskId}」。`,
  overtime: c => `「${c.taskName}」${c.detail},超出常规了。继续等还是收兵,你拍板(子任务 ${c.subtaskId})。`,
  repeat_fail: c => `「${c.taskName}」${c.detail}还是黑,继续重试大概率白费。要不要换个思路?(子任务 ${c.subtaskId})`,
}

// 提醒去重:同一子任务 10 分钟内只提醒一次
const lastNotifiedAt = new Map<string, number>()
const DEDUP_MS = 10 * 60_000

function shouldNotify(subtaskId: string, now: Date): boolean {
  const last = lastNotifiedAt.get(subtaskId) ?? 0
  if (now.getTime() - last < DEDUP_MS) return false
  lastNotifiedAt.set(subtaskId, now.getTime())
  return true
}

async function lastTurnAtOf(subtaskId: string, fallback: string): Promise<string | null> {
  try {
    const turns = await getSubtaskTurns(subtaskId)
    if (!turns || turns.length === 0) return null
    const ends = turns.map(t => t.endedAt).filter(Boolean).sort()
    return ends[ends.length - 1] ?? fallback
  } catch {
    return null
  }
}

async function checkUser(userId: string): Promise<void> {
  const activeTasks = await getActiveTasks(userId)
  const now = new Date()
  for (const task of activeTasks) {
    for (const st of task.subtasks) {
      if (st.status !== 'running') continue
      const lastTurnAt = await lastTurnAtOf(st.id, st.startedAt ?? st.updatedAt)
      const signal = evaluateSubtaskRisk({
        status: st.status,
        startedAt: st.startedAt ?? st.createdAt,
        updatedAt: st.updatedAt,
        lastTurnAt,
        hasLiveSession: bus.isRegistered(st.id),
        retryCount: st.retryCount ?? 0,
      }, now)
      if (!signal) continue
      if (!shouldNotify(st.id, now)) continue

      const text = SIGNAL_TEXT[signal.kind]({
        agentName: st.assignee,
        taskName: task.name,
        subtaskId: st.id,
        detail: signal.detail,
      })
      // 前端监控面板标黄(重派/取消的快捷入口挂在面板项上)
      broadcast('watchdog', JSON.stringify({
        taskId: task.id, subtaskId: st.id, agentName: st.assignee,
        taskName: task.name, reason: signal.kind, detail: signal.detail,
      }), userId)
      const pushed = await pushProactiveMessage(userId, text)
      if (!pushed) console.log(`[watchdog] 静默时段/频控拦截,信号已记录: ${st.id} ${signal.kind}`)
    }
  }
}

let timer: NodeJS.Timeout | null = null

export function startWatchdog(): void {
  if (timer) return
  const { intervalMin, idleMin, maxMin } = getSettings().watchdog
  timer = setInterval(() => {
    checkAllUsers().catch(err => console.error('[watchdog] 巡检失败:', err instanceof Error ? err.message : err))
  }, intervalMin * 60_000)
  console.log(`[watchdog] 已启动:每 ${intervalMin} 分钟巡检,无动静 ${idleMin}min / 超时 ${maxMin}min 报告(L1 只提醒)`)
}

export function stopWatchdog(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function checkAllUsers(): Promise<void> {
  const users = await listUsers()
  for (const u of users) {
    try {
      await checkUser(u.id)
    } catch (err) {
      // 单个用户失败不影响其他人
      console.error(`[watchdog] 用户 ${u.id} 巡检失败:`, err instanceof Error ? err.message : err)
    }
  }
}

export const _internals = { checkUser }
