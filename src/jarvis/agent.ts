import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AgentCard, Message, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server'
import { agentCardHandler, jsonRpcHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express'
import { config } from '../shared/config.js'
import pool from '../shared/db.js'
import { think } from './brain.js'
import { getTaskSummary, listTasks } from '../task/manager.js'
import { getState } from './state.js'
import { listAllRunningTasks } from '../a2a/registry.js'
import { listAgentSessions } from '../a2a/history.js'
import { listRecipes } from '../team/registry.js'
import { listCredentials, addCredential, updateCredential, deleteCredential } from '../auth/credentials.js'
import { bus } from '../a2a/bus.js'
import { interruptAgent, closeAgent } from '../a2a/client.js'
import { authRouter } from '../auth/auth.js'
import { authMiddleware } from '../auth/middleware.js'

type SSEClient = {
  id: string
  userId: string
  res: express.Response
}

const sseClients: SSEClient[] = []

export function broadcast(type: string, content: string, userId?: string) {
  const data = JSON.stringify({ type, content, timestamp: new Date().toISOString() })
  const targets = userId ? sseClients.filter(c => c.userId === userId) : sseClients
  for (const client of targets) {
    client.res.write(`data: ${data}\n\n`)
  }
}

function addSSEClient(id: string, userId: string, res: express.Response) {
  sseClients.push({ id, userId, res })
  res.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === id)
    if (idx >= 0) sseClients.splice(idx, 1)
  })
}

const jarvisCard: AgentCard = {
  name: 'Jarvis',
  description: '你的私人 AI 管家。理解意图、规划方案、调度团队、监控执行、汇报结果。',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: `http://localhost:${config.jarvisPort}/a2a/jsonrpc`,
  skills: [
    { id: 'task-management', name: '任务管理', description: '接收任务、拆解、调度执行', tags: ['task'] },
    { id: 'chat', name: '对话', description: '回答问题、闲聊', tags: ['chat'] },
  ],
  capabilities: { streaming: true, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
}

class JarvisExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage
    const textPart = userMessage.parts.find(p => p.kind === 'text')
    const userText = textPart && 'text' in textPart ? textPart.text : ''

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      final: false,
    }
    eventBus.publish(statusUpdate)

    const thinkResult = await think('system', userText, (progress) => {
      broadcast('progress', progress)
    })

    const responseMessage: Message = {
      kind: 'message',
      messageId: randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text: thinkResult.response }],
      contextId: requestContext.contextId,
    }
    eventBus.publish(responseMessage)

    const finalUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() },
      final: true,
    }
    eventBus.publish(finalUpdate)
    eventBus.finished()
  }

  cancelTask = async (): Promise<void> => {}
}

export function startJarvisServer(): express.Express {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  })

  // Auth routes (no auth required)
  app.use(authRouter())

  const executor = new JarvisExecutor()
  const requestHandler = new DefaultRequestHandler(jarvisCard, new InMemoryTaskStore(), executor)

  // A2A endpoints
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }))
  app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))
  app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))

  // All routes below require auth
  app.use(authMiddleware)

  // ─── SSE 实时事件流（后台任务进度、告警等）───
  app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const clientId = `cli-${Date.now()}`
    addSSEClient(clientId, req.userId!, res)
    res.write(`data: ${JSON.stringify({ type: 'connected', content: '已连接 Jarvis 事件流' })}\n\n`)
  })

  // ─── 简单 HTTP Chat 端点 (SSE 流式) ───
  app.post('/chat', async (req, res) => {
    const { message } = req.body
    if (!message) {
      res.status(400).json({ error: 'message is required' })
      return
    }

    // 设置 SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (type: string, content: string) => {
      res.write(`data: ${JSON.stringify({ type, content })}\n\n`)
    }

    sendEvent('thinking', '正在思考...')

    try {
      const result = await think(req.userId!, message, (progress) => {
        sendEvent('progress', progress)
      }, (delta) => {
        sendEvent('delta', delta)
      })
      sendEvent('response', result.response)
      if (result.artifact) {
        sendEvent('artifact', JSON.stringify(result.artifact))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendEvent('response', `[错误] ${msg}`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  })

  // ─── 任务状态查询端点 ───
  app.get('/tasks', async (req, res) => {
    res.json({ summary: await getTaskSummary(req.userId!), tasks: await listTasks(req.userId!) })
  })

  // ─── 对话历史 ───
  app.get('/api/conversation', async (req, res) => {
    const { rows: sessionRows } = await pool.query(
      'SELECT id FROM user_jarvis_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [req.userId!]
    )
    if (sessionRows.length === 0) { res.json([]); return }
    const { rows } = await pool.query(
      `SELECT m.role, m.content, m.timestamp, m.artifact_id,
              a.type AS artifact_type, a.title AS artifact_title
       FROM user_jarvis_messages m
       LEFT JOIN jarvis_artifacts a ON m.artifact_id = a.id
       WHERE m.session_id = $1 ORDER BY m.timestamp ASC`,
      [sessionRows[0].id]
    )
    res.json(rows.map(r => ({
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
      artifact: r.artifact_id ? { id: r.artifact_id, type: r.artifact_type, title: r.artifact_title } : undefined,
    })))
  })

  // ─── Artifact 详情 ───
  app.get('/api/artifact/:id', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, type, title, content, language FROM jarvis_artifacts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    )
    if (rows.length === 0) { res.status(404).json({ code: 404, message: '制品不存在' }); return }
    res.json({ code: 0, ...rows[0] })
  })

  // ─── Dashboard API ───
  app.get('/api/state', async (req, res) => {
    res.json(await getState(req.userId!))
  })

  app.get('/api/agents', (req, res) => {
    res.json(listAllRunningTasks(req.userId!))
  })

  app.get('/api/history', async (req, res) => {
    res.json(await listAgentSessions(req.userId!))
  })

  app.get('/api/recipes', async (req, res) => {
    res.json(await listRecipes(req.userId!))
  })

  // ─── 用户凭证管理（BYOK）───
  app.get('/api/credentials', async (req, res) => {
    res.json(await listCredentials(req.userId!))
  })

  app.post('/api/credentials', async (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    if (!label || !tier || !apiKey || !baseUrl || !model) {
      res.status(400).json({ error: 'label、tier、apiKey、baseUrl、model 均为必填' })
      return
    }
    const cred = await addCredential(req.userId!, { label, tier, apiKey, baseUrl, model, isDefault })
    res.json(cred)
  })

  app.put('/api/credentials/:id', async (req, res) => {
    const { label, tier, apiKey, baseUrl, model, isDefault } = req.body
    const cred = await updateCredential(req.userId!, req.params.id, { label, tier, apiKey, baseUrl, model, isDefault })
    if (!cred) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json(cred)
  })

  app.delete('/api/credentials/:id', async (req, res) => {
    const ok = await deleteCredential(req.userId!, req.params.id)
    if (!ok) { res.status(404).json({ error: '凭证不存在' }); return }
    res.json({ ok: true })
  })

  // ─── Agent 通信端点（走 MessageBus）───
  app.post('/api/agent/send', (req, res) => {
    const { subtaskId, message } = req.body
    if (!subtaskId || !message) {
      res.status(400).json({ error: 'subtaskId and message required' })
      return
    }
    if (!bus.isRegistered(subtaskId)) {
      res.json({ success: false, error: 'agent not running' })
      return
    }
    bus.notify('jarvis', subtaskId, subtaskId, message)
    res.json({ success: true })
  })

  app.post('/api/agent/interrupt', async (req, res) => {
    const { subtaskId } = req.body
    if (!subtaskId) {
      res.status(400).json({ error: 'subtaskId required' })
      return
    }
    const ok = await interruptAgent(subtaskId)
    res.json({ success: ok })
  })

  app.post('/api/agent/close', (req, res) => {
    const { subtaskId } = req.body
    if (!subtaskId) {
      res.status(400).json({ error: 'subtaskId required' })
      return
    }
    const ok = closeAgent(subtaskId)
    res.json({ success: ok })
  })

  // ─── Bus 状态端点 ───
  app.get('/api/bus/agents', (req, res) => {
    res.json(bus.listAgents())
  })

  app.get('/api/bus/conversations', async (req, res) => {
    res.json(await bus.getAllConversations())
  })

  app.get('/api/bus/conversations/:contextId', async (req, res) => {
    const conv = await bus.getConversation(req.params.contextId)
    if (!conv) { res.status(404).json({ error: 'not found' }); return }
    res.json(conv)
  })

  // Serve frontend static files in production
  const distPath = path.resolve(import.meta.dirname, '../../web/dist')
  app.use(express.static(distPath))
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/a2a') || req.path.startsWith('/.well-known') || req.path.startsWith('/auth')) {
      return next()
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })

  app.listen(config.jarvisPort, () => {
    console.log(`  Jarvis A2A Server: http://localhost:${config.jarvisPort}`)
    console.log(`  Chat API: http://localhost:${config.jarvisPort}/chat`)
  })

  return app
}
