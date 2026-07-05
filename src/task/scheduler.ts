import type { SubTask, SubTaskStatus } from '../shared/types.js'
import { getTask, updateSubTask, getNextRunnableSubTask, getAllRunnableSubTasks, updateTask } from './manager.js'

export function scheduleNext(taskId: string): SubTask | undefined {
  const task = getTask(taskId)
  if (!task) return undefined
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return undefined
  }

  const next = getNextRunnableSubTask(taskId)
  if (next) {
    updateSubTask(taskId, next.id, { status: 'running' })
    updateTask(taskId, { status: 'executing' })
    return { ...next, status: 'running' }
  }

  checkTaskCompletion(taskId)
  return undefined
}

export function scheduleAllRunnable(taskId: string): SubTask[] {
  const task = getTask(taskId)
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return []

  const runnables = getAllRunnableSubTasks(taskId)
  for (const st of runnables) {
    updateSubTask(taskId, st.id, { status: 'running' })
  }
  if (runnables.length > 0) {
    updateTask(taskId, { status: 'executing' })
  }
  return runnables.map(st => ({ ...st, status: 'running' as SubTaskStatus }))
}

export function checkTaskCompletion(taskId: string): boolean {
  const task = getTask(taskId)
  if (!task) return false

  const allDone = task.subtasks.every(st => st.status === 'completed')
  if (allDone && task.subtasks.length > 0) {
    const results = task.subtasks
      .map(st => `## ${st.name}\n${st.result || '(无结果)'}`)
      .join('\n\n')
    updateTask(taskId, { status: 'completed', result: results })
    return true
  }
  return false
}

export function handleSubTaskComplete(taskId: string, subtaskId: string, result: string) {
  updateSubTask(taskId, subtaskId, { status: 'completed', result })
}

export function handleSubTaskFailed(taskId: string, subtaskId: string, error: string) {
  updateSubTask(taskId, subtaskId, { status: 'failed', error })
}

export function handleSubTaskBlocked(taskId: string, subtaskId: string, reason: string) {
  updateSubTask(taskId, subtaskId, { status: 'input-required', blockedReason: reason })
  updateTask(taskId, { status: 'blocked' })
}
