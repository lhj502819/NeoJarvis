import express from 'express'
import { randomUUID } from 'crypto'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { getModelRuntime, getJarvisModel } from '../shared/pi-models.js'
import type { AgentCard, Message, TaskStatusUpdateEvent } from '@a2a-js/sdk'
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server'
import { agentCardHandler, jsonRpcHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express'
import type { AgentRecipe } from '../shared/types.js'
import { config } from '../shared/config.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'

import { homedir } from 'os'


class RecipeExecutor implements AgentExecutor {
  constructor(private recipe: AgentRecipe, private userId: string) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage
    const textPart = userMessage.parts.find(p => p.kind === 'text')
    const taskDescription = textPart && 'text' in textPart ? textPart.text : ''

    const workingUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      final: false,
    }
    eventBus.publish(workingUpdate)

    let result = ''

    try {
      const workDir = (this.recipe.context.cwd as string) || homedir()

      // MCP 工具(降级:返回空数组,见 user-mcp.ts 迁移说明)
      const userMcpTools: ToolDefinition[] = await buildUserMcpServers(this.userId).catch(() => [])

      const modelRuntime = await getModelRuntime()
      const model = await getJarvisModel(this.recipe.model || 'sonnet')
      if (!model) throw new Error('未找到可用的 LLM 模型(桥接 provider 与 Pi 默认均未配置)')
      const loader = new DefaultResourceLoader({
        cwd: workDir,
        agentDir: getAgentDir(),
        systemPromptOverride: () => this.recipe.systemPrompt,
      })
      await loader.reload()

      const { session } = await createAgentSession({
        cwd: workDir,
        model,
        modelRuntime,
        customTools: userMcpTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(workDir),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      })

      // 订阅:把最终 assistant 文本累积成 result
      const textAccumulator = { value: '' }
      try {
        const unsubscribe = session.subscribe((event) => {
          if (event.type === 'message_update') {
            const ae = event.assistantMessageEvent
            if (ae.type === 'text_delta' && ae.delta) {
              textAccumulator.value += ae.delta
            }
          }
          if (event.type === 'agent_end') {
            const messages = event.messages
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i] as any
              if (m.role === 'assistant' && Array.isArray(m.content)) {
                const texts = m.content
                  .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
                  .map((b: any) => b.text)
                if (texts.length > 0) {
                  result = texts.join('')
                  break
                }
              }
            }
          }
        })

        await session.prompt(taskDescription)
        unsubscribe()
      } finally {
        session.dispose()
      }

      if (!result) result = textAccumulator.value || ''

      const responseMessage: Message = {
        kind: 'message',
        messageId: randomUUID(),
        role: 'agent',
        parts: [{ kind: 'text', text: result }],
        contextId: requestContext.contextId,
      }
      eventBus.publish(responseMessage)

      const completedUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: { state: 'completed', timestamp: new Date().toISOString() },
        final: true,
      }
      eventBus.publish(completedUpdate)
      eventBus.finished()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      const failedUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: { state: 'failed', timestamp: new Date().toISOString() },
        final: true,
      }
      eventBus.publish(failedUpdate)
      eventBus.finished()
      throw err
    }
  }

  cancelTask = async (): Promise<void> => {}
}

interface AgentInstance {
  recipeId: string
  port: number
  app: express.Express
}

const activeInstances: Map<string, AgentInstance> = new Map()
let nextPort = config.agentBasePort

export function startAgentServer(recipe: AgentRecipe, userId: string = 'system'): AgentInstance {
  const existing = activeInstances.get(recipe.id)
  if (existing) return existing

  const port = nextPort++
  const app = express()

  const agentCard: AgentCard = {
    name: recipe.name,
    description: recipe.description,
    protocolVersion: '0.3.0',
    version: '0.1.0',
    url: `http://localhost:${port}/a2a/jsonrpc`,
    skills: [{ id: 'execute', name: '执行任务', description: recipe.description, tags: ['execute'] }],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  }

  const executor = new RecipeExecutor(recipe, userId)
  const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor)

  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }))
  app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))
  app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }))

  app.listen(port, () => {
    console.log(`  [团队] ${recipe.name} 已启动: http://localhost:${port}`)
  })

  const instance: AgentInstance = { recipeId: recipe.id, port, app }
  activeInstances.set(recipe.id, instance)
  return instance
}

export function getAgentInstance(recipeId: string): AgentInstance | undefined {
  return activeInstances.get(recipeId)
}

export function getAgentUrl(recipeId: string): string | undefined {
  const instance = activeInstances.get(recipeId)
  return instance ? `http://localhost:${instance.port}` : undefined
}
