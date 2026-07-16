import type { Response } from 'express'

export interface SSEClient {
  id: string
  userId: string
  res: Response
}

const sseClients: SSEClient[] = []

export function addSSEClient(id: string, userId: string, res: Response): void {
  sseClients.push({ id, userId, res })
  res.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === id)
    if (idx >= 0) sseClients.splice(idx, 1)
  })
}

/**
 * source 用于前端区分同一 type 的事件来源:
 *   - 'live-reply' : orchestrator 中当前对话的实时回复(与 /chat 流内容一致,只是走 /events 兜底)
 *   - 'task-report': 后台子任务完成后 Jarvis 的复盘汇报(非当前对话产物)
 *   - 'task-error' : 子任务异常时的错误汇报
 *   - undefined    : 其他类型事件(progress/subtask/artifact_pinned...) 或历史/无来源事件
 * 前端 applyLiveEvent 只有 source==='live-reply' 才允许把 thinking/streaming 气泡就地替换,
 * 其他 source 一律作为独立新气泡追加,避免"回复被后台任务汇报覆盖"。
 */
export function broadcast(type: string, content: string, userId?: string, source?: string): void {
  const payload: Record<string, unknown> = { type, content, timestamp: new Date().toISOString() }
  if (source) payload.source = source
  const data = JSON.stringify(payload)
  const targets = userId ? sseClients.filter(c => c.userId === userId) : sseClients
  for (const client of targets) {
    client.res.write(`data: ${data}\n\n`)
  }
}
