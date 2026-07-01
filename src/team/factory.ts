import express from 'express'
import { v4 as uuidv4 } from 'uuid'
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

import { homedir } from 'os'

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
const HOME_DIR = homedir()

class RecipeExecutor implements AgentExecutor {
  constructor(private recipe: AgentRecipe) {}

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

      for await (const message of query({
        prompt: taskDescription,
        options: {
          systemPrompt: this.recipe.systemPrompt,
          pathToClaudeCodeExecutable: CLAUDE_PATH,
          allowedTools: this.recipe.tools,
          cwd: workDir,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 20,
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
        messageId: uuidv4(),
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
let nextPort = 3001

export function startAgentServer(recipe: AgentRecipe): AgentInstance {
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

  const executor = new RecipeExecutor(recipe)
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
