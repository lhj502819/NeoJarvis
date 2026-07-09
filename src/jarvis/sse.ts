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

export function broadcast(type: string, content: string, userId?: string): void {
  const data = JSON.stringify({ type, content, timestamp: new Date().toISOString() })
  const targets = userId ? sseClients.filter(c => c.userId === userId) : sseClients
  for (const client of targets) {
    client.res.write(`data: ${data}\n\n`)
  }
}
