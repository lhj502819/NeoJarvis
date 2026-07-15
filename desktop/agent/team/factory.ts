import express from 'express'
import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
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

function findClaudePath(): string {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim()
  } catch {
    console.error('错误: 找不到 claude CLI，请确保已安装并在 PATH 中')
    process.exit(1)
  }
}

const CLAUDE_PATH = findClaudePath()
const HOME_DIR = homedir()

class RecipeExecutor implements AgentExecutor {
  // userId 由 startAgentServer 注入(默认 'system');A2A executor 内没有请求上下文携带用户,
  // 用来给 buildUserMcpServers 拿本机 hub + DB user + 黑名单合并出的 MCP 池。
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
      const workDir = (this.recipe.context.cwd as string) || HOME_DIR

      // 与 client.ts 主路径对齐:MCP 通过 buildUserMcpServers 拿(hub + DB user + 黑名单)。
      // A2A executor 里 userId 由 startAgentServer 注入;失败则降级为空对象(不阻塞派单)。
      const mcpServers = await buildUserMcpServers(this.userId).catch(() => ({}))

      // 允许 recipe.tools 之外调用任意 MCP 工具(方案 1:在调 SDK 处统一追加 'mcp__*' 通配)。
      // 如果 recipe 里的 tools 白名单没写 mcp__*,SDK 在 bypassPermissions 模式下也会拒调 —— 补一条。
      const allowedTools = [...this.recipe.tools, 'mcp__*']

      for await (const message of query({
        prompt: taskDescription,
        options: {
          systemPrompt: this.recipe.systemPrompt,
          pathToClaudeCodeExecutable: CLAUDE_PATH,
          allowedTools,
          cwd: workDir,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 20,
          mcpServers,
        },
      })) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if ('text' in block && block.text) {
              result += block.text
            }
          }
        }
        if (message.type === 'result' && message.subtype === 'success') {
          if (!result) result = message.result
        }
      }

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
