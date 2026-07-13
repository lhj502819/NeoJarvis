import { getAgentUrl } from '../team/factory.js'
import { getRecipe } from '../team/registry.js'

interface RunningTask {
  taskId: string
  subtaskId: string
  recipeId: string
  description: string
  startedAt: number
  userId: string
  agentType: 'permanent' | 'adhoc'
  agentName: string
}

const runningTasks: RunningTask[] = []

export function registerRunningTask(userId: string, taskId: string, subtaskId: string, recipeId: string, description: string, agentType: 'permanent' | 'adhoc' = 'adhoc', agentName?: string) {
  runningTasks.push({ userId, taskId, subtaskId, recipeId, description, startedAt: Date.now(), agentType, agentName: agentName || recipeId })
}

export function unregisterRunningTask(subtaskId: string) {
  const idx = runningTasks.findIndex(t => t.subtaskId === subtaskId)
  if (idx >= 0) runningTasks.splice(idx, 1)
}

export interface PeerInfo {
  name: string
  subtaskId: string
  url: string
  task: string
}

export async function getPeerAgents(userId: string, taskId: string, excludeSubtaskId: string): Promise<PeerInfo[]> {
  const results: PeerInfo[] = []
  const filtered = runningTasks.filter(t => t.taskId === taskId && t.subtaskId !== excludeSubtaskId)
  for (const t of filtered) {
    const recipe = await getRecipe(userId, t.recipeId)
    const url = getAgentUrl(t.recipeId)
    results.push({
      name: recipe?.name || t.recipeId,
      subtaskId: t.subtaskId,
      url: url || '',
      task: t.description,
    })
  }
  return results
}

export function getRunningTasksForAgent(recipeId: string): RunningTask[] {
  return runningTasks.filter(t => t.recipeId === recipeId)
}

export function listAllRunningTasks(userId?: string) {
  const filtered = userId ? runningTasks.filter(t => t.userId === userId) : runningTasks
  return filtered.map(t => {
    const url = getAgentUrl(t.recipeId)
    return {
      name: t.agentName,
      recipeId: t.recipeId,
      agentType: t.agentType,
      url: url || null,
      taskId: t.taskId,
      subtaskId: t.subtaskId,
      description: t.description,
      startedAt: t.startedAt,
    }
  })
}
