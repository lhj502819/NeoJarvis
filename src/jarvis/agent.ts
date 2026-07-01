import express from 'express'
import { v4 as uuidv4 } from 'uuid'
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
import { think } from './brain.js'
import { getTaskSummary } from '../task/manager.js'

type SSEClient = {
  id: string
  res: express.Response
}

const sseClients: SSEClient[] = []

export function broadcast(type: string, content: string) {
  const data = JSON.stringify({ type, content, timestamp: new Date().toISOString() })
  for (const client of sseClients) {
    client.res.write(`data: ${data}\n\n`)
  }
}

function addSSEClient(id: string, res: express.Response) {
  sseClients.push({ id, res })
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

    const response = await think(userText, (progress) => {
      broadcast('progress', progress)
    })

    const responseMessage: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: response }],
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

  const executor = new JarvisExecutor()
  const requestHandler = new DefaultRequestHandler(jarvisCard, new InMemoryTaskStore(), executor)

  // A2A endpoints
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }))
  app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))
  app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))

  // ─── SSE 实时事件流（后台任务进度、告警等）───
  app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const clientId = `cli-${Date.now()}`
    addSSEClient(clientId, res)
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
      const response = await think(message, (progress) => {
        sendEvent('progress', progress)
      })
      sendEvent('response', response)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendEvent('response', `[错误] ${msg}`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  })

  // ─── 任务状态查询端点 ───
  app.get('/tasks', (req, res) => {
    res.json({ summary: getTaskSummary() })
  })

  app.listen(config.jarvisPort, () => {
    console.log(`  Jarvis A2A Server: http://localhost:${config.jarvisPort}`)
    console.log(`  Chat API: http://localhost:${config.jarvisPort}/chat`)
  })

  return app
}
