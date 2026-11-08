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
import { startWatchdog } from './watchdog.js'
import { startPromotionWatch } from './promotion-watch.js'
import { startEventSystem } from '../events/router.js'
import { authRouter } from '../auth/auth.js'
import { authMiddleware } from '../auth/middleware.js'
import { chatRoutes } from './routes/chat.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { agentRoutes } from './routes/agent.js'
import { configRoutes } from './routes/config.js'
import { timelineRoutes } from './routes/timeline.js'
import { approvalRoutes } from './routes/approvals.js'
import { initPersonaCache } from './persona.js'
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

  // 前端资源必须在 authMiddleware 之前 —— HTML/JS/CSS 是公开的,登录在 SPA 内部完成。
  // 否则未带 cookie 取 / 会被 auth 拦成 401,Electron 渲染出黑屏(prod 从 3000 取前端)。
  // 本文件在 desktop/agent/jarvis/,退三级到 repo 根再进 web/dist(../../ 只到 desktop,少一级)。
  const distPath = path.resolve(import.meta.dirname, '../../../web/dist')
  app.use(express.static(distPath))

  // SPA 回退:也放 auth 之前(前端路由路径无需登录即可拿到壳 HTML,登录在 SPA 内做)。
  // 关键:后端还有 /tasks /events /chat 这类不带 /api 前缀的路由,绝不能被回退吞掉(否则 prod 下
  // 这些接口返回 index.html、前端 JSON 解析失败 → 任务/历史/事件全空)。真实资源(带扩展名)也不兜,
  // 交给 static 的自然 404。只有"无扩展名的 GET 前端路径"才发 index.html。
  const backendPrefixes = ['/api', '/a2a', '/.well-known', '/auth', '/tasks', '/events', '/chat']
  app.get('/{*path}', (req, res, next) => {
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next()  // 带扩展名 = 资源,不是前端路由
    if (backendPrefixes.some(p => req.path === p || req.path.startsWith(p + '/'))) return next()  // 后端路由,放行给下方
    res.sendFile(path.join(distPath, 'index.html'))
  })

  // All routes below require auth
  app.use(authMiddleware)
  app.use(chatRoutes())
  app.use(dashboardRoutes())
  app.use(agentRoutes())
  app.use(configRoutes())
  app.use(timelineRoutes())
  app.use(approvalRoutes())

  // persona 配置缓存:监听前加载(旧文件导入 + 文档表读取),watchdog/events 起来前就绪(P4)
  const ready = initPersonaCache().catch(err => console.error('[persona] 缓存初始化失败:', err))

  app.listen(config.jarvisPort, () => {
    console.log(`  Jarvis A2A Server: http://localhost:${config.jarvisPort}`)
    console.log(`  Chat API: http://localhost:${config.jarvisPort}/chat`)
    // Watchdog(定时巡检 running 任务)+ 事件系统(cron 晨报 / 京ME 源)—— HTTP 就绪后拉起
    void ready.then(() => {
      try { startWatchdog() } catch (err) { console.error('[watchdog] 启动失败:', err) }
      try { startPromotionWatch() } catch (err) { console.error('[promotion-watch] 启动失败:', err) }
      startEventSystem().catch(err => console.error('[events] 启动失败:', err))
    })
  })

  return app
}
