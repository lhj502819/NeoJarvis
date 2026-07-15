import { Router } from 'express'
import * as orchestrator from '../orchestrator.js'
import { addSSEClient } from '../sse.js'
import { getChatImage } from '../conversation.js'
import { serverGet } from '../../shared/server-client.js'

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

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
    const { message, images } = req.body
    // 校验图片:media_type 白名单 + 单张 base64 上限(~5MB 原图 → base64 约 6.8MB 字符)
    const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    const MAX_B64 = 7_000_000
    const cleanImages: Array<{ mediaType: string; data: string }> = Array.isArray(images)
      ? images.filter((im: any) =>
          im && typeof im.data === 'string' && ALLOWED.includes(im.mediaType) && im.data.length <= MAX_B64
        ).map((im: any) => ({ mediaType: im.mediaType, data: im.data }))
      : []
    if (!message && cleanImages.length === 0) {
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

    await orchestrator.enqueueMessage(req.userId!, message || '', writer, cleanImages)
  })

  router.get('/api/chat/status', (req, res) => {
    res.json(orchestrator.getStatus(req.userId!))
  })

  // 取回对话图片(base64 → data URL)
  router.get('/api/chat-image/:id', async (req, res) => {
    const img = await getChatImage(req.userId!, req.params.id)
    if (!img) { res.status(404).json({ error: 'not found' }); return }
    const buf = Buffer.from(img.data, 'base64')
    res.setHeader('Content-Type', img.mediaType)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.send(buf)
  })

  router.get('/api/conversation', async (req, res) => {
    // Java GET /api/conversation returns the latest session's messages oldest-first, already
    // shaped as { role, content, timestamp, artifact?, imageIds? } — the exact response the
    // old inline PG query produced, so this is a straight pass-through.
    res.json(await serverGet(req.userId!, '/api/conversation'))
  })

  router.get('/api/artifact/:id', async (req, res) => {
    // Java GET /api/artifact/{id} returns { code: 0, ... } (or 404 with the same body shape).
    try {
      res.json(await serverGet(req.userId!, `/api/artifact/${encodeURIComponent(req.params.id)}`))
    } catch (err) {
      if (isNotFound(err)) { res.status(404).json({ code: 404, message: '制品不存在' }); return }
      throw err
    }
  })

  return router
}
