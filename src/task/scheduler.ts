import type { SubTask, SubTaskStatus } from '../shared/types.js'
import { getTask, updateSubTask, getNextRunnableSubTask, getAllRunnableSubTasks, updateTask } from './manager.js'

export function scheduleNext(userId: string, taskId: string): SubTask | undefined {
  const task = getTask(userId, taskId)
  if (!task) return undefined
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return undefined
  }

  const next = getNextRunnableSubTask(userId, taskId)
  if (next) {
    updateSubTask(userId, taskId, next.id, { status: 'running' })
    updateTask(userId, taskId, { status: 'executing' })
    return { ...next, status: 'running' }
  }

  checkTaskCompletion(userId, taskId)
  return undefined
}

export function scheduleAllRunnable(userId: string, taskId: string): SubTask[] {
  const task = getTask(userId, taskId)
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return []

  const runnables = getAllRunnableSubTasks(userId, taskId)
  for (const st of runnables) {
    updateSubTask(userId, taskId, st.id, { status: 'running' })
  }
  if (runnables.length > 0) {
    updateTask(userId, taskId, { status: 'executing' })
  }
  return runnables.map(st => ({ ...st, status: 'running' as SubTaskStatus }))
}

export function checkTaskCompletion(userId: string, taskId: string): boolean {
  const task = getTask(userId, taskId)
  if (!task) return false

  const allDone = task.subtasks.every(st => st.status === 'completed')
  if (allDone && task.subtasks.length > 0) {
    const results = task.subtasks
      .map(st => `## ${st.name}\n${st.result || '(无结果)'}`)
      .join('\n\n')
    updateTask(userId, taskId, { status: 'completed', result: results })
    return true
  }
  return false
}

export function handleSubTaskComplete(userId: string, taskId: string, subtaskId: string, result: string) {
  updateSubTask(userId, taskId, subtaskId, { status: 'completed', result })
}

export function handleSubTaskFailed(userId: string, taskId: string, subtaskId: string, error: string) {
  updateSubTask(userId, taskId, subtaskId, { status: 'failed', error })
}

export function handleSubTaskBlocked(userId: string, taskId: string, subtaskId: string, reason: string) {
  updateSubTask(userId, taskId, subtaskId, { status: 'input-required', blockedReason: reason })
  updateTask(userId, taskId, { status: 'blocked' })
}
