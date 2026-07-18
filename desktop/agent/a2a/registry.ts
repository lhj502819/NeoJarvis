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
  // 实时进度:小弟每回合经 onProgress 更新,供前端刷新后重建监控栏时填真实值(而非 0)
  turnCount: number
  currentTool?: string
}

const runningTasks: RunningTask[] = []

export function registerRunningTask(userId: string, taskId: string, subtaskId: string, recipeId: string, description: string, agentType: 'permanent' | 'adhoc' = 'adhoc', agentName?: string) {
  runningTasks.push({ userId, taskId, subtaskId, recipeId, description, startedAt: Date.now(), agentType, agentName: agentName || recipeId, turnCount: 0 })
}

/** 更新运行中子任务的实时进度(回合数 / 当前工具)。小弟每 turn 经 onProgress 调用。 */
export function updateRunningTaskProgress(subtaskId: string, turnCount: number, currentTool?: string) {
  const t = runningTasks.find(t => t.subtaskId === subtaskId)
  if (t) {
    t.turnCount = turnCount
    t.currentTool = currentTool
  }
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

/**
 * 按 taskId 列出仍在运行的子任务(内存态,含 userId/agentName 等)。
 * 用于任务被取消时给前端补发结束事件 —— 取消不走小弟的正常完成流程,
 * 若不主动广播,MonitorPanel 里那条 running 会一直挂到页面刷新。
 */
export function getRunningSubtasksForTask(taskId: string): RunningTask[] {
  return runningTasks.filter(t => t.taskId === taskId)
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
      turnCount: t.turnCount,
      currentTool: t.currentTool,
    }
  })
}
