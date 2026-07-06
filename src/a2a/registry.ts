import { getAgentUrl } from '../team/factory.js'
import { getRecipe } from '../team/registry.js'

interface RunningTask {
  taskId: string
  subtaskId: string
  recipeId: string
  description: string
  startedAt: number
  userId: string
}

const runningTasks: RunningTask[] = []

export function registerRunningTask(userId: string, taskId: string, subtaskId: string, recipeId: string, description: string) {
  runningTasks.push({ userId, taskId, subtaskId, recipeId, description, startedAt: Date.now() })
}

export function unregisterRunningTask(subtaskId: string) {
  const idx = runningTasks.findIndex(t => t.subtaskId === subtaskId)
  if (idx >= 0) runningTasks.splice(idx, 1)
}

export interface PeerInfo {
  name: string
  url: string
  task: string
}

export function getPeerAgents(userId: string, taskId: string, excludeSubtaskId: string): PeerInfo[] {
  return runningTasks
    .filter(t => t.taskId === taskId && t.subtaskId !== excludeSubtaskId)
    .map(t => {
      const recipe = getRecipe(userId, t.recipeId)
      const url = getAgentUrl(t.recipeId)
      return {
        name: recipe?.name || t.recipeId,
        url: url || `unknown`,
        task: t.description,
      }
    })
    .filter(p => p.url !== 'unknown')
}

export function getRunningTasksForAgent(recipeId: string): RunningTask[] {
  return runningTasks.filter(t => t.recipeId === recipeId)
}

export function listAllRunningTasks(userId?: string) {
  const filtered = userId ? runningTasks.filter(t => t.userId === userId) : runningTasks
  return filtered.map(t => {
    const url = getAgentUrl(t.recipeId)
    return {
      name: t.recipeId,
      recipeId: t.recipeId,
      url: url || null,
      taskId: t.taskId,
      subtaskId: t.subtaskId,
      description: t.description,
      startedAt: t.startedAt,
    }
  })
}
