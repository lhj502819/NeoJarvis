import { Router } from 'express'
import { bus } from '../../a2a/bus.js'
import { interruptAgent, closeAgent } from '../../a2a/client.js'

export function agentRoutes(): Router {
  const router = Router()

  router.post('/api/agent/send', (req, res) => {
    const { subtaskId, message } = req.body
    if (!subtaskId || !message) {
      res.status(400).json({ error: 'subtaskId and message required' })
      return
    }
    if (!bus.isRegistered(subtaskId)) {
      res.json({ success: false, error: 'agent not running' })
      return
    }
    bus.notify(req.userId!, 'jarvis', subtaskId, subtaskId, message)
    res.json({ success: true })
  })

  router.post('/api/agent/interrupt', async (req, res) => {
    const { subtaskId } = req.body
    if (!subtaskId) {
      res.status(400).json({ error: 'subtaskId required' })
      return
    }
    const ok = await interruptAgent(subtaskId)
    res.json({ success: ok })
  })

  router.post('/api/agent/close', (req, res) => {
    const { subtaskId } = req.body
    if (!subtaskId) {
      res.status(400).json({ error: 'subtaskId required' })
      return
    }
    const ok = closeAgent(subtaskId)
    res.json({ success: ok })
  })

  router.get('/api/bus/agents', (req, res) => {
    res.json(bus.listAgents())
  })

  router.get('/api/bus/conversations', async (req, res) => {
    res.json(await bus.getAllConversations())
  })

  router.get('/api/bus/conversations/:contextId', async (req, res) => {
    const conv = await bus.getConversation(req.params.contextId)
    if (!conv) { res.status(404).json({ error: 'not found' }); return }
    res.json(conv)
  })

  return router
}
