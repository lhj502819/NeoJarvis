import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { buildSystemPrompt } from './prompt.js'
import { createTask, updateTask, addSubTask, getTask, getTaskSummary, listTasks, updateSubTask } from '../task/manager.js'
import { scheduleAllRunnable, handleSubTaskComplete, handleSubTaskFailed, checkTaskCompletion } from '../task/scheduler.js'
import { listRecipes, getRecipe, createRecipe, incrementUsage } from '../team/registry.js'
import { dispatchToAgent, interruptAgent } from '../a2a/client.js'
import { registerRunningTask, unregisterRunningTask } from '../a2a/registry.js'
import { evaluatePromotion } from '../team/promoter.js'
import { bus } from '../a2a/bus.js'
import { broadcast } from './agent.js'
import { searchMemory, addMemory } from '../memory/everos.js'
import { onMessageHandled, onTaskCompleted, onTaskFailed } from './state.js'
import { loadJson, saveJson } from '../shared/store.js'
import { agentEnv } from '../shared/config.js'

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
const HOME_DIR = homedir()

// 注册 Jarvis 到 MessageBus — 处理小弟的请示
bus.register('jarvis', 'Jarvis', async (msg) => {
  const question = msg.parts.find(p => p.kind === 'text')?.text || ''
  if (!question) return null

  const reply = await withBrainLock(() => rawLlmCall(
    `你是 Jarvis。你的一个小弟在执行任务时遇到问题向你请示。请直接给出简短的决策或回答，不要输出 JSON。`,
    `小弟的问题：${question}`
  ))

  return {
    id: `reply-${Date.now()}`,
    from: 'jarvis',
    to: msg.from,
    contextId: msg.contextId,
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: reply || '继续执行，自行判断。' }],
    timestamp: new Date().toISOString(),
  }
})


interface ActionResponse {
  action: string
  data: Record<string, unknown>
}

const taskAbortControllers: Map<string, AbortController> = new Map()

export function abortTask(taskId: string) {
  const controller = taskAbortControllers.get(taskId)
  if (controller) {
    controller.abort()
    taskAbortControllers.delete(taskId)
  }
}

function getOrCreateAbortController(taskId: string): AbortController {
  let controller = taskAbortControllers.get(taskId)
  if (!controller) {
    controller = new AbortController()
    taskAbortControllers.set(taskId, controller)
  }
  return controller
}

// 序列化大脑调用 — 避免并发 query() 进程冲突
let brainLock: Promise<void> = Promise.resolve()

function withBrainLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = brainLock
  let resolve: () => void
  brainLock = new Promise(r => { resolve = r })
  return prev.then(fn).finally(() => resolve!())
}

function parseAction(text: string): ActionResponse | null {
  // 尝试匹配 ```json ... ``` 代码块（宽松：允许缩进、空行）
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  // 回退：尝试匹配裸 JSON 对象（整段或尾部）
  const braceMatch = text.match(/\{[\s\S]*"action"\s*:\s*"[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0].trim())
    } catch {}
  }

  return null
}

async function llmCall(prompt: string): Promise<string> {
  const systemPrompt = buildSystemPrompt()
  return withBrainLock(() => rawLlmCall(systemPrompt, prompt))
}

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')

function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[debug]\x1b[0m', ...args)
}

async function rawLlmCall(systemPrompt: string, prompt: string): Promise<string> {
  debug('rawLlmCall start, prompt length:', prompt.length)
  let result = ''
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      pathToClaudeCodeExecutable: CLAUDE_PATH,
      cwd: HOME_DIR,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      env: agentEnv,
      maxTurns: 99999,
    },
  })) {
    debug('msg:', message.type, (message as any).subtype || '', (message as any).message?.content?.map((b: any) => b.type).join(',') || '')
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if ('text' in block && block.text) {
          result += block.text
        }
        if ('type' in block && block.type === 'tool_use') {
          const toolName = (block as any).name || 'tool'
          debug('tool_use:', toolName)
          broadcast('progress', `🔧 Jarvis 正在使用 ${toolName}...`)
        }
      }
    }
    if (message.type === 'result') {
      debug('result:', (message as any).subtype, 'text length:', result.length)
      if (message.subtype === 'success') {
        if (!result) result = message.result
      } else {
        const err = (message as any).errors?.join('; ') || (message as any).subtype
        debug('result ERROR:', err)
        if (!result) result = `[错误] ${err}`
      }
    }
  }
  debug('rawLlmCall done, result length:', result.length)
  return result
}

async function executeSubTask(taskId: string, subtaskId: string, description: string, assignee: string, signal: AbortSignal, resumeSession?: string): Promise<string> {
  if (signal.aborted) throw new Error('任务已取消')

  const recipe = getRecipe(assignee)
  const agentId = recipe ? recipe.id : `adhoc-${subtaskId.slice(0, 6)}`

  if (recipe) {
    incrementUsage(recipe.id)
  }

  registerRunningTask(taskId, subtaskId, agentId, description)
  try {
    const result = await dispatchToAgent(assignee, description, {
      taskId,
      subtaskId,
      signal,
      resumeSession,
      onProgress: (progress) => {
        updateSubTask(taskId, subtaskId, { progress })
      },
    })
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (signal.aborted) throw new Error('任务已取消')
    return `执行失败: ${msg}`
  } finally {
    unregisterRunningTask(subtaskId)
  }
}

function executeTaskInBackground(taskId: string, subtasks: Array<{ name: string; description: string; assignee?: string; resumeSession?: string }>) {
  ;(async () => {
    const task = getTask(taskId)
    if (!task) return

    const controller = getOrCreateAbortController(taskId)
    const signal = controller.signal

    const resumeMap = new Map<string, string>()
    for (const st of subtasks) {
      const assignee = st.assignee || 'general'
      const sub = addSubTask(taskId, { name: st.name, description: st.description, assignee })
      if (st.resumeSession) {
        resumeMap.set(sub.id, st.resumeSession)
      }
    }
    updateTask(taskId, { status: 'executing' })

    let completed = 0
    while (true) {
      if (signal.aborted) break

      const currentTask = getTask(taskId)
      if (currentTask?.status === 'cancelled') {
        controller.abort()
        break
      }

      const runnables = scheduleAllRunnable(taskId)
      if (runnables.length === 0) break

      if (runnables.length > 1) {
        broadcast('progress', `⚡ 并行启动 ${runnables.length} 个子任务...`)
      }

      const results = await Promise.allSettled(
        runnables.map(st => executeSubTask(taskId, st.id, st.description, st.assignee, signal, resumeMap.get(st.id)))
      )

      if (signal.aborted) break

      for (let i = 0; i < runnables.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
          handleSubTaskComplete(taskId, runnables[i].id, r.value)
          completed++
          broadcast('progress', `✅ [${completed}/${subtasks.length}] ${runnables[i].name} — 完成`)
          onTaskCompleted()
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          handleSubTaskFailed(taskId, runnables[i].id, errMsg)
          broadcast('progress', `❌ ${runnables[i].name} — 失败`)
        }
      }
    }

    taskAbortControllers.delete(taskId)

    if (!signal.aborted) {
      try { evaluatePromotion() } catch {}

      checkTaskCompletion(taskId)
      const finalTask = getTask(taskId)
      if (finalTask?.status === 'completed' && finalTask.result) {
        broadcast('progress', `正在为您整理汇报...`)

        const reportPrompt = `你是 Jarvis，一个有幽默感的私人管家。称呼用户为 Sir。\n` +
          `你刚刚完成了任务「${finalTask.name}」。以下是团队交回的原始结果：\n\n${finalTask.result}\n\n` +
          `请向 Sir 汇报结果。要求：\n` +
          `- 直接输出汇报内容，不要输出 JSON\n` +
          `- 保留关键信息，去掉冗余\n` +
          `- 用清晰的结构（列表、表格都行）\n` +
          `- 语气像管家汇报，不是写文档\n` +
          `- 太长就给精华摘要，说一句"详细版随时可以展开"`

        const summary = await withBrainLock(() => rawLlmCall(reportPrompt, '请汇报'))
        const report = summary || finalTask.result
        broadcast('response', report)
        addToBuffer('jarvis', report)
      }
    }
  })().catch(err => {
    if (err?.message?.includes('取消')) return
    broadcast('response', `[错误] 任务执行异常: ${err instanceof Error ? err.message : String(err)}`)
  })
}

export async function think(userMessage: string, onProgress?: (text: string) => void): Promise<string> {
  debug('think() called:', userMessage.slice(0, 50))
  addToBuffer('user', userMessage)

  const taskContext = getTaskSummary()
  const recipes = listRecipes()
  const teamInfo = recipes.map(r => `- ${r.name} (id: ${r.id}): ${r.description}`).join('\n')

  // 从 EverOS 检索相关记忆
  debug('searching memory...')
  onProgress?.('正在回忆相关信息...')
  const memories = await searchMemory(userMessage, 5)
  debug('memory done, length:', memories.length)

  const recentConvo = getRecentConversation()

  const contextualPrompt = `## 当前任务状态
${taskContext}

## 可用团队成员
${teamInfo || '暂无团队成员'}

${memories ? `## 关于 Sir 的记忆\n${memories}\n` : ''}
## 本次会话对话记录
${recentConvo || '(刚开始对话)'}

## Sir 最新消息
${userMessage}`

  onProgress?.('正在分析你的需求...')
  const llmResponse = await llmCall(contextualPrompt)

  const action = parseAction(llmResponse)

  if (!action) {
    // 兜底：即使没解析出 action，也把 JSON 块从回复里清掉
    const cleaned = llmResponse.replace(/```(?:json)?[\s\S]*?```/g, '').trim()
    const finalResponse = cleaned || llmResponse
    addToBuffer('jarvis', finalResponse)
    saveConversation(userMessage, finalResponse)
    return finalResponse
  }

  let response: string

  switch (action.action) {
    case 'create_task': {
      const { name, description, subtasks } = action.data as {
        name: string
        description: string
        subtasks?: Array<{ name: string; description: string; assignee?: string }>
      }
      const task = createTask(name, description)
      updateTask(task.id, { status: 'planning' })

      const preamble = llmResponse.split('```json')[0].trim()

      if (subtasks && subtasks.length > 0) {
        const subtaskList = subtasks.map((st, i) => `  ${i + 1}. ${st.name}`).join('\n')
        response = preamble
          ? `${preamble}\n\n执行计划：\n${subtaskList}\n\n正在后台执行，有进展会通知您。`
          : `明白，Sir。已创建任务「${name}」，计划：\n${subtaskList}\n\n正在后台执行，有进展会通知您。`

        executeTaskInBackground(task.id, subtasks)
      } else {
        response = preamble || `已创建任务「${name}」(${task.id})，等待进一步规划。`
      }
      break
    }

    case 'respond': {
      response = (action.data as { message: string }).message
      break
    }

    case 'cancel_task': {
      const { taskId, reason } = action.data as { taskId: string; reason?: string }

      if (taskId === 'all') {
        const activeTasks = listTasks().filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
        for (const t of activeTasks) {
          updateTask(t.id, { status: 'cancelled' })
          abortTask(t.id)
        }
        response = `已取消全部 ${activeTasks.length} 个任务，Sir。${reason ? `原因：${reason}` : ''}`
      } else {
        const task = getTask(taskId)
        if (!task) {
          const activeTasks = listTasks().filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
          if (activeTasks.length > 0) {
            for (const t of activeTasks) {
              updateTask(t.id, { status: 'cancelled' })
              abortTask(t.id)
            }
            response = `已取消全部 ${activeTasks.length} 个活跃任务，Sir。`
          } else {
            response = '当前没有可取消的任务，Sir。'
          }
        } else {
          updateTask(taskId, { status: 'cancelled' })
          abortTask(taskId)
          response = `已取消任务「${task.name}」，Sir。`
        }
      }
      break
    }

    case 'ask_user': {
      response = (action.data as { question: string }).question
      break
    }

    case 'send_message': {
      const { subtaskId, message: msg } = action.data as { subtaskId: string; message: string }
      if (bus.isRegistered(subtaskId)) {
        bus.notify('jarvis', subtaskId, subtaskId, msg)
        response = `已把消息发给 agent (${subtaskId.slice(0, 6)})：「${msg.slice(0, 40)}」`
        broadcast('progress', `💬 Jarvis → Agent: ${msg.slice(0, 40)}`)
      } else {
        response = `发送失败，该 agent 可能已完成或不在运行中。`
      }
      break
    }

    case 'interrupt_agent': {
      const { subtaskId: stId } = action.data as { subtaskId: string }
      const interrupted = await interruptAgent(stId)
      response = interrupted
        ? `已打断 agent (${stId.slice(0, 6)})。`
        : `打断失败，该 agent 可能已结束。`
      break
    }

    default: {
      const cleanResponse = llmResponse.replace(/```json[\s\S]*?```/, '').trim()
      response = cleanResponse || llmResponse
    }
  }

  onMessageHandled()
  addToBuffer('jarvis', response)
  saveConversation(userMessage, response)
  return response
}

const sessionId = `jarvis-main`

interface ConversationTurn {
  role: 'user' | 'jarvis'
  content: string
  timestamp: number
}

const CONVERSATION_FILE = 'conversation.json'
const MAX_BUFFER_TURNS = 20
const CONVERSATION_TTL = 4 * 60 * 60 * 1000 // 4小时过期

function loadBuffer(): ConversationTurn[] {
  const turns = loadJson<ConversationTurn[]>(CONVERSATION_FILE, [])
  if (turns.length === 0) return []
  // 过期清理：最后一条消息超过 TTL 就认为是新会话
  const lastTimestamp = turns[turns.length - 1].timestamp
  if (Date.now() - lastTimestamp > CONVERSATION_TTL) return []
  return turns
}

const conversationBuffer: ConversationTurn[] = loadBuffer()

function addToBuffer(role: 'user' | 'jarvis', content: string) {
  conversationBuffer.push({ role, content, timestamp: Date.now() })
  if (conversationBuffer.length > MAX_BUFFER_TURNS) {
    conversationBuffer.splice(0, conversationBuffer.length - MAX_BUFFER_TURNS)
  }
  saveJson(CONVERSATION_FILE, conversationBuffer)
}

function getRecentConversation(): string {
  if (conversationBuffer.length === 0) return ''
  return conversationBuffer
    .map(t => `${t.role === 'user' ? 'Sir' : 'Jarvis'}: ${t.content}`)
    .join('\n')
}

function saveConversation(userMessage: string, jarvisResponse: string) {
  const now = Date.now()
  addMemory(sessionId, [
    { role: 'user', timestamp: now, content: userMessage },
    { role: 'assistant', timestamp: now + 100, content: jarvisResponse },
  ]).catch(() => {})
}
