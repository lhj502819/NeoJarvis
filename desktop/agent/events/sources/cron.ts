import { listUsers } from '../../auth/users.js'
import { getSettings } from '../../jarvis/persona.js'
import { getScheduleTask, listScheduleTasks, markTaskLastRun, nextFireTime } from '../../jarvis/schedule.js'
import type { EventSourceDef, JarvisEvent } from '../types.js'

/**
 * Cron 源:定时晨报 + 用户自定义定时任务(配置页「定时任务」)。
 *
 * 两条调度来自不同存储:
 *   - 晨报:data/persona/settings.json 的 morningReport(内置任务,不可删;at 为空或 enabled=false 停用)
 *   - 用户任务:文档表 kind='cron-task'(增删改后由配置 API 调 reloadCronSchedule 重排,即时生效)
 *
 * 到点行为:
 *   - 晨报 → emit 'morning_report'(router 生成晨报并主动推送)
 *   - 用户任务 → emit 'scheduled_task'(router 把指令交给 Jarvis 完整 think)
 * 每次触发后重排该任务的下一次(以及所有任务,任务量很小,重排成本可忽略)。
 */

let timers: NodeJS.Timeout[] = []
let stopped = false
let running = false
let emitRef: ((ev: JarvisEvent) => void) | null = null
// 调度代数:并发 scheduleAll(快速连续保存配置/保存撞上启动)时,旧代数的
// timer 一律不注册 —— 否则互相 clearAll 会静默丢掉部分任务的调度
let scheduleSeq = 0

function clearAll(): void {
  for (const t of timers) clearTimeout(t)
  timers = []
}

/** 配置变更后调用:立即重排所有定时(保存即生效,不需要重启)。 */
export async function reloadCronSchedule(): Promise<void> {
  if (!running) return
  await scheduleAll()
}

export function createCronSource(): EventSourceDef {
  return {
    id: 'cron',
    start(ctx) {
      stopped = false
      running = true
      emitRef = ctx.emit
      void scheduleAll()
    },
    stop() {
      stopped = true
      running = false
      clearAll()
    },
  }
}

async function scheduleAll(): Promise<void> {
  if (stopped || !emitRef) return
  const seq = ++scheduleSeq
  clearAll()
  const settings = getSettings()

  const morningAt = settings.morningReport.at.trim()
  const morningOn = settings.morningReport.enabled !== false && !!morningAt
  if (morningOn) scheduleMorning(morningAt, seq)

  const users = await listUsers().catch(() => [])
  if (seq !== scheduleSeq) return   // 已被更新的重排取代,本轮作废
  let taskCount = 0
  for (const u of users) {
    const tasks = await listScheduleTasks(u.id).catch(() => [])
    if (seq !== scheduleSeq) return
    for (const task of tasks) {
      if (!task.enabled) continue
      const next = nextFireTime(task.freq, task.days, task.time)
      if (!next) continue
      if (seq !== scheduleSeq) return
      const delay = Math.max(1_000, next.getTime() - Date.now())
      const timer = setTimeout(() => { void fireTask(u.id, task.id) }, delay)
      if (seq === scheduleSeq) timers.push(timer)
      taskCount += 1
    }
  }
  console.log(
    `[events] cron 源已排程:晨报 ${morningOn ? `每日 ${morningAt}` : '已停用'},` +
    `用户定时任务 ${taskCount} 个`,
  )
}

function scheduleMorning(at: string, seq: number): void {
  if (!emitRef) return
  const next = nextFireTime('daily', [], at)
  if (!next) {
    console.warn(`[events] cron 源:晨报时间「${at}」无效,跳过`)
    return
  }
  const delay = Math.max(1_000, next.getTime() - Date.now())
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const users = await listUsers()
        for (const u of users) {
          emitRef?.({
            id: `cron-morning-${Date.now()}-${u.id}`,
            source: 'cron',
            type: 'morning_report',
            userId: u.id,
            payload: {},
            receivedAt: Date.now(),
          })
        }
      } catch (err) {
        console.error('[events] cron 源:晨报事件发送失败:', err instanceof Error ? err.message : err)
      } finally {
        void scheduleAll() // 排下一天(同时刷新用户任务的下一次)
      }
    })()
  }, delay)
  if (seq === scheduleSeq) timers.push(timer)
  console.log(`[events] cron 源:晨报每日 ${at},下一次 ${next.toLocaleString('zh-CN')}`)
}

async function fireTask(userId: string, taskId: string): Promise<void> {
  if (stopped || !emitRef) return
  try {
    const task = await getScheduleTask(userId, taskId)
    if (!task || task.builtin || !task.enabled) {
      void scheduleAll()
      return
    }
    emitRef({
      id: `cron-task-${taskId}-${Date.now()}`,
      source: 'cron',
      type: 'scheduled_task',
      userId,
      payload: { taskId: task.id, name: task.name, cmd: task.cmd, time: task.time, freq: task.freq, days: task.days },
      receivedAt: Date.now(),
    })
    await markTaskLastRun(userId, taskId, true).catch(() => {})
    console.log(`[events] 定时任务触发:「${task.name}」(${task.time})`)
  } catch (err) {
    await markTaskLastRun(userId, taskId, false).catch(() => {})
    console.error('[events] 定时任务触发失败:', err instanceof Error ? err.message : err)
  } finally {
    void scheduleAll()
  }
}
