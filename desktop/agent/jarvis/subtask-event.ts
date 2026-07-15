export interface SubtaskEventPayload {
  subtaskId: string
  taskId: string
  agentName: string
  agentType: 'permanent' | 'adhoc'
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  elapsedMs?: number
  error?: string
}

export function buildSubtaskEvent(input: {
  subtaskId: string
  taskId: string
  agentName: string
  agentType?: 'permanent' | 'adhoc'
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  startedAt?: number
  error?: string
}): SubtaskEventPayload {
  const payload: SubtaskEventPayload = {
    subtaskId: input.subtaskId,
    taskId: input.taskId,
    agentName: input.agentName,
    agentType: input.agentType || 'adhoc',
    taskName: input.taskName,
    status: input.status,
    turnCount: input.turnCount,
  }
  if (input.currentAction !== undefined) payload.currentAction = input.currentAction
  if (input.currentTool !== undefined) payload.currentTool = input.currentTool
  if (input.startedAt !== undefined) payload.elapsedMs = Math.max(0, Date.now() - input.startedAt)
  if (input.error !== undefined) payload.error = input.error
  return payload
}
