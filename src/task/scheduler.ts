import type { SubTask, SubTaskStatus } from '../shared/types.js'
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

export async function checkTaskCompletion(userId: string, taskId: string): Promise<boolean> {
  const task = await getTask(userId, taskId)
  if (!task) return false

  const allDone = task.subtasks.every(st => st.status === 'completed')
  if (allDone && task.subtasks.length > 0) {
    const results = task.subtasks
      .map(st => `## ${st.name}\n${st.result || '(无结果)'}`)
      .join('\n\n')
    await updateTask(userId, taskId, { status: 'completed', result: results })
    return true
  }
  return false
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
