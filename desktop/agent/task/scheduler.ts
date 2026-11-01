import type { SubTask, SubTaskStatus, TaskStatus } from '../shared/types.js'
import { getTask, updateSubTask, getNextRunnableSubTask, getAllRunnableSubTasks, updateTask } from './manager.js'

export async function scheduleNext(userId: string, taskId: string): Promise<SubTask | undefined> {
  const task = await getTask(userId, taskId)
  if (!task) return undefined
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return undefined
  }

  const next = await getNextRunnableSubTask(userId, taskId)
  if (next) {
    await updateSubTask(userId, taskId, next.id, { status: 'running' })
    await updateTask(userId, taskId, { status: 'executing' })
    return { ...next, status: 'running' }
  }

  await checkTaskCompletion(userId, taskId)
  return undefined
}

export async function scheduleAllRunnable(userId: string, taskId: string): Promise<SubTask[]> {
  const task = await getTask(userId, taskId)
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return []

  const runnables = await getAllRunnableSubTasks(userId, taskId)
  for (const st of runnables) {
    await updateSubTask(userId, taskId, st.id, { status: 'running' })
  }
  if (runnables.length > 0) {
    await updateTask(userId, taskId, { status: 'executing' })
  }
  return runnables.map(st => ({ ...st, status: 'running' as SubTaskStatus }))
}

const TERMINAL_SUBTASK: SubTaskStatus[] = ['completed', 'failed', 'cancelled']

export async function checkTaskCompletion(userId: string, taskId: string): Promise<boolean> {
  const task = await getTask(userId, taskId)
  if (!task) return false
  if (task.subtasks.length === 0) return false

  // 只要所有子任务进入终态(completed/failed/cancelled)就结算 —— 不再要求"全部 completed"。
  // 否则一个小弟失败/取消,整个任务永远停在 executing,Jarvis 一句汇报都不发(静默 bug)。
  const allSettled = task.subtasks.every(st => TERMINAL_SUBTASK.includes(st.status))
  if (!allSettled) return false

  // 聚合所有子任务产出,失败/取消的显式标注 + 带上错因,让 Jarvis 汇报时能如实说清。
  const results = task.subtasks
    .map(st => {
      const tag = st.status === 'completed' ? '' : st.status === 'failed' ? '（执行失败）' : '（已取消）'
      const body = st.status === 'completed'
        ? (st.result || '(无结果)')
        : (st.error || st.result || '(无产出)')
      return `## ${st.name}${tag}\n${body}`
    })
    .join('\n\n')

  // 有任一成功产出就按 completed 结算(个别失败会在汇报里点明);全军覆没(无一 completed)才算 failed。
  const finalStatus: TaskStatus = task.subtasks.some(st => st.status === 'completed') ? 'completed' : 'failed'
  await updateTask(userId, taskId, { status: finalStatus, result: results })
  return true
}

export async function handleSubTaskComplete(userId: string, taskId: string, subtaskId: string, result: string) {
  await updateSubTask(userId, taskId, subtaskId, { status: 'completed', result })
}

export async function handleSubTaskFailed(userId: string, taskId: string, subtaskId: string, error: string) {
  await updateSubTask(userId, taskId, subtaskId, { status: 'failed', error })
}

export async function handleSubTaskBlocked(userId: string, taskId: string, subtaskId: string, reason: string) {
  await updateSubTask(userId, taskId, subtaskId, { status: 'input-required', blockedReason: reason })
  await updateTask(userId, taskId, { status: 'blocked' })
}
