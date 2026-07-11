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
import { think } from './brain.js'
import { broadcast } from './sse.js'
import { authRouter } from '../auth/auth.js'
import { authMiddleware } from '../auth/middleware.js'
import { chatRoutes } from './routes/chat.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { agentRoutes } from './routes/agent.js'
import './lifecycle.js'

export { broadcast } from './sse.js'

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
  app.use(express.json({ limit: '15mb' }))  // 放大以容纳 base64 图片
  app.use(cookieParser())
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  })

  // Auth routes (no auth required)
  app.use(authRouter())

  // A2A protocol endpoints
  const executor = new JarvisExecutor()
  const requestHandler = new DefaultRequestHandler(jarvisCard, new InMemoryTaskStore(), executor)
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }))
  app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))
  app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))

  // All routes below require auth
  app.use(authMiddleware)
  app.use(chatRoutes())
  app.use(dashboardRoutes())
  app.use(agentRoutes())

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
