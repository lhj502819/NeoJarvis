import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { getPeerAgents } from './registry.js'
import { getRecipe } from '../team/registry.js'
import { recordAgentSession } from './history.js'
import { bus } from './bus.js'
import { buildUserEnv } from '../shared/user-env.js'

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')
function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[agent-debug]\x1b[0m', ...args)
}

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
const HOME_DIR = homedir()

function isRetryableError(err: string): boolean {
  const retryable = ['internal server error', 'overloaded', '529', '500', '502', '503', 'rate limit', 'timeout', 'ECONNRESET', 'ETIMEDOUT']
  const lower = err.toLowerCase()
  return retryable.some(pat => lower.includes(pat))
}

export interface DispatchContext {
  userId: string
  taskId: string
  subtaskId: string
  domain?: string
  cwd?: string
  signal?: AbortSignal
  resumeSession?: string
  onProgress?: (progress: string) => void
}

const activeQueries = new Map<string, Query>()

export function getActiveQuery(subtaskId: string): Query | undefined {
  return activeQueries.get(subtaskId)
}

export async function sendToAgent(subtaskId: string, message: string): Promise<boolean> {
  const q = activeQueries.get(subtaskId)
  if (!q) return false

  const userMessage = {
    type: 'user' as const,
    message: { role: 'user' as const, content: message },
    parent_tool_use_id: null,
  }

  try {
    await q.streamInput((async function*() { yield userMessage })())
    debug('sent message to agent:', subtaskId.slice(0, 6), message.slice(0, 40))
    return true
  } catch (err) {
    debug('failed to send to agent:', err)
    return false
  }
}

export async function interruptAgent(subtaskId: string): Promise<boolean> {
  const q = activeQueries.get(subtaskId)
  if (!q) return false
  try {
    await q.interrupt()
    debug('interrupted agent:', subtaskId.slice(0, 6))
    return true
  } catch {
    return false
  }
}

export function closeAgent(subtaskId: string): boolean {
  const q = activeQueries.get(subtaskId)
  if (!q) return false
  q.close()
  activeQueries.delete(subtaskId)
  debug('closed agent:', subtaskId.slice(0, 6))
  return true
}

export async function dispatchToAgent(recipeId: string, taskDescription: string, context?: DispatchContext): Promise<string> {
  const userId = context?.userId || 'system'
  const recipe = getRecipe(userId, recipeId)

  const adhocPrompt = `你是一个专项任务执行者，负责完成分配给你的任务。认真执行，返回详细结果。

如果遇到需求歧义、方向不确定、或需要额外信息，用 [NEED_INPUT] 标记请示管家 Jarvis：
格式：[NEED_INPUT] 你的问题
然后等待回复继续执行。`

  const agentName = recipe?.name || recipeId
  const systemPrompt = recipe?.systemPrompt || adhocPrompt
  const tools = recipe?.tools || ['Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
  // 门牌号：小弟 recipe 自带 cwd > 本次任务指定 cwd（开发类）。纯调研类无门牌号。
  const recordedCwd = (recipe?.context?.cwd as string) || context?.cwd || ''
  // 执行工作目录：有门牌号就用，否则兜底 HOME（但兜底值不写进 history）
  const workDir = recordedCwd || HOME_DIR
  const domain = context?.domain || ''

  let enrichedDescription = taskDescription

  if (context) {
    const peers = getPeerAgents(userId, context.taskId, context.subtaskId)
    if (peers.length > 0) {
      const peerList = peers.map(p => `- ${p.name}: 正在做「${p.task}」`).join('\n')
      enrichedDescription += `\n\n## 协作 Agent\n你正在和以下 agent 并行工作：\n${peerList}`
    }
  }

  if (context?.signal?.aborted) throw new Error('任务已取消')

  const resumeSessionId = context?.resumeSession
  const subtaskId = context?.subtaskId || `anon-${Date.now()}`
  const taskId = context?.taskId || 'unknown'

  debug('dispatch start:', recipeId, 'task:', taskDescription.slice(0, 50), resumeSessionId ? `(resume: ${resumeSessionId.slice(0, 8)})` : '(new)')

  const queryOptions: Record<string, any> = {
    systemPrompt,
    pathToClaudeCodeExecutable: CLAUDE_PATH,
    allowedTools: tools,
    cwd: workDir,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    env: buildUserEnv(userId),
    maxTurns: 99999,
  }

  if (resumeSessionId) {
    queryOptions.resume = resumeSessionId
  }

  const MAX_RETRIES = 2
  const RETRY_DELAYS = [3000, 8000]

  let lastError = ''
  let result = ''
  let sessionId = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (context?.signal?.aborted) throw new Error('任务已取消')

    if (attempt > 0) {
      debug(`retry attempt ${attempt}/${MAX_RETRIES}, waiting ${RETRY_DELAYS[attempt - 1]}ms...`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]))
      if (context?.signal?.aborted) throw new Error('任务已取消')
      context?.onProgress?.(`⚠️ API 错误，第 ${attempt} 次重试中...`)
    }

    result = ''
    sessionId = ''
    let turnCount = 0
    const progressLog: string[] = []
    let apiError = false

    // 注册到 bus — handler 处理 Jarvis/其他 agent 发来的消息
    bus.register(subtaskId, `${agentName}#${subtaskId.slice(0, 6)}`, async (msg) => {
      const text = msg.parts.find(p => p.kind === 'text')?.text || ''
      const sent = await sendToAgent(subtaskId, text)
      if (sent) {
        debug('bus → agent injected:', text.slice(0, 40))
      }
      return null
    })

    const q = query({ prompt: enrichedDescription, options: queryOptions })
    activeQueries.set(subtaskId, q)

    try {
      for await (const message of q) {
        if (context?.signal?.aborted) {
          q.close()
          throw new Error('任务已取消')
        }

        // 检查 inbox（Jarvis 或其他 agent 发来的消息）
        const inboxMessages = bus.drainInbox(subtaskId)
        for (const inMsg of inboxMessages) {
          const text = inMsg.parts.find(p => p.kind === 'text')?.text || ''
          if (text) await sendToAgent(subtaskId, text)
        }

        debug('agent msg:', message.type, (message as any).subtype || '')

        if (message.type === 'assistant' && message.message?.content) {
          turnCount++
          let turnText = ''

          for (const block of message.message.content) {
            if ('text' in block && block.text) {
              result += block.text
              turnText += block.text
              const snippet = block.text.slice(0, 60).replace(/\n/g, ' ')
              progressLog.push(`[${turnCount}] ${snippet}`)
            }
            if ('type' in block && block.type === 'tool_use') {
              const toolName = (block as any).name || 'tool'
              progressLog.push(`[${turnCount}] 🔧 ${toolName}`)
            }
          }

          if (context?.onProgress) {
            const recent = progressLog.slice(-5).join('\n')
            context.onProgress(`回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`)
          }

          // 检测小弟请示 → 走 bus 发给 Jarvis
          if (turnText.includes('[NEED_INPUT]')) {
            const question = turnText.split('[NEED_INPUT]')[1]?.trim() || turnText
            debug('agent requesting via bus:', question.slice(0, 50))

            const reply = await bus.send(subtaskId, 'jarvis', taskId, question)
            if (reply) {
              const replyText = reply.parts.find(p => p.kind === 'text')?.text || ''
              if (replyText) {
                await sendToAgent(subtaskId, replyText)
              }
            }
          }
        }

        if (message.type === 'result') {
          sessionId = (message as any).session_id || (message as any).sessionId || ''
          if (message.subtype === 'success') {
            if (!result) result = message.result
            debug('agent done, session:', sessionId, 'result length:', result.length)
          } else {
            const err = (message as any).errors?.join('; ') || (message as any).subtype
            debug('agent ERROR:', err)
            lastError = err
            if (isRetryableError(err) && attempt < MAX_RETRIES) {
              apiError = true
            } else {
              if (!result) result = `[执行错误] ${err}`
            }
          }
        }
      }
    } finally {
      activeQueries.delete(subtaskId)
      bus.unregister(subtaskId)
    }

    if (!apiError) break
    debug('retryable error detected, will retry:', lastError)
  }

  const finalSessionId = sessionId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // 聚类主键是 domain（语义领域），cwd 仅作开发类任务的门牌号辅料（纯调研为空）
  recordAgentSession(userId, finalSessionId, recipeId, taskDescription, domain, recordedCwd)
  debug('recorded agent session:', finalSessionId, 'domain:', domain)

  return result || '(无结果)'
}
