import { Router } from 'express'
import * as orchestrator from '../orchestrator.js'
import { addSSEClient } from '../sse.js'
import pool from '../../shared/db.js'

export function chatRoutes(): Router {
  const router = Router()

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const clientId = `cli-${Date.now()}`
    addSSEClient(clientId, req.userId!, res)
    res.write(`data: ${JSON.stringify({ type: 'connected', content: '已连接 Jarvis 事件流' })}\n\n`)
  })

  router.post('/chat', async (req, res) => {
    const { message } = req.body
    if (!message) {
      res.status(400).json({ error: 'message is required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const writer: orchestrator.SSEWriter = {
      id: `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      send: (type, content) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, content })}\n\n`)
      },
      end: () => {
        if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end() }
      },
      closed: false,
    }

    res.on('close', () => {
      writer.closed = true
      orchestrator.handleDisconnect(req.userId!, writer.id)
    })

    await orchestrator.enqueueMessage(req.userId!, message, writer)
  })

  router.get('/api/chat/status', (req, res) => {
    res.json(orchestrator.getStatus(req.userId!))
  })

  router.get('/api/conversation', async (req, res) => {
    const { rows: sessionRows } = await pool.query(
      'SELECT id FROM user_jarvis_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [req.userId!]
    )
    if (sessionRows.length === 0) { res.json([]); return }
    const { rows } = await pool.query(
      `SELECT role, content, timestamp, artifact_id, artifact_type, artifact_title FROM (
        SELECT m.role, m.content, m.timestamp, m.artifact_id,
               a.type AS artifact_type, a.title AS artifact_title
        FROM user_jarvis_messages m
        LEFT JOIN jarvis_artifacts a ON m.artifact_id = a.id
        WHERE m.session_id = $1 ORDER BY m.timestamp DESC LIMIT 500
      ) sub ORDER BY timestamp ASC`,
      [sessionRows[0].id]
    )
    res.json(rows.map(r => ({
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
      artifact: r.artifact_id ? { id: r.artifact_id, type: r.artifact_type, title: r.artifact_title } : undefined,
    })))
  })

  router.get('/api/artifact/:id', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, type, title, content, language FROM jarvis_artifacts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    )
    if (rows.length === 0) { res.status(404).json({ code: 404, message: '制品不存在' }); return }
    res.json({ code: 0, ...rows[0] })
  })

  return router
}
