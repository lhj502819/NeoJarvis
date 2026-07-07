import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { buildSystemPrompt } from './prompt.js'
import { createJarvisTools } from './tools.js'
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
import { buildUserEnv } from '../shared/user-env.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'
import { redactSecrets } from '../shared/redact.js'
import db from '../shared/db.js'

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
const HOME_DIR = homedir()

// 注册 Jarvis 到 MessageBus — 处理小弟的请示
bus.register('jarvis', 'Jarvis', async (msg) => {
  const question = msg.parts.find(p => p.kind === 'text')?.text || ''
  if (!question) return null

  const reply = await withBrainLock('system', () => rawLlmCall(
    'system',
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

// 序列化大脑调用 — 每用户独立锁，互不阻塞
const brainLocks = new Map<string, Promise<void>>()

function withBrainLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = brainLocks.get(userId) || Promise.resolve()
  let resolve: () => void
  brainLocks.set(userId, new Promise(r => { resolve = r }))
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

async function llmCall(userId: string, prompt: string, onDelta?: (text: string) => void): Promise<string> {
  const systemPrompt = buildSystemPrompt(userId)
  const mcpServers: Record<string, McpServerConfig> = {
    'jarvis-system': createJarvisTools(userId),
    ...buildUserMcpServers(userId),
  }
  return withBrainLock(userId, () => rawLlmCall(userId, systemPrompt, prompt, onDelta, mcpServers))
}

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')

function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[debug]\x1b[0m', ...args)
}

async function rawLlmCall(userId: string, systemPrompt: string, prompt: string, onDelta?: (text: string) => void, mcpServers?: Record<string, McpServerConfig>): Promise<string> {
  const t0 = Date.now()
  debug('rawLlmCall start, prompt length:', prompt.length)
  console.log(`[perf] rawLlmCall start, system prompt: ${systemPrompt.length} chars, user prompt: ${prompt.length} chars`)
  let result = ''
  let firstTokenTime = 0
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      pathToClaudeCodeExecutable: CLAUDE_PATH,
      cwd: HOME_DIR,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      env: buildUserEnv(userId),
      maxTurns: 99999,
      ...(mcpServers && { mcpServers }),
    },
  })) {
    debug('msg:', message.type, (message as any).subtype || '', (message as any).message?.content?.map((b: any) => b.type).join(',') || '')
    if (message.type === 'assistant' && message.message?.content) {
      if (!firstTokenTime) {
        firstTokenTime = Date.now()
        console.log(`[perf] first token: ${firstTokenTime - t0}ms`)
      }
      for (const block of message.message.content) {
        if ('text' in block && block.text) {
          result += block.text
          onDelta?.(block.text)
        }
        if ('type' in block && block.type === 'tool_use') {
          const toolName = (block as any).name || 'tool'
          debug('tool_use:', toolName)
          broadcast('progress', `🔧 Jarvis 正在使用 ${toolName}...`, userId)
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
  console.log(`[perf] rawLlmCall done: ${Date.now() - t0}ms total, result: ${result.length} chars`)
  return result
}

async function executeSubTask(userId: string, taskId: string, subtaskId: string, description: string, assignee: string, signal: AbortSignal, resumeSession?: string, domain?: string, cwd?: string): Promise<string> {
  if (signal.aborted) throw new Error('任务已取消')

  const recipe = getRecipe(userId, assignee)
  const agentId = recipe ? recipe.id : `adhoc-${subtaskId.slice(0, 6)}`

  if (recipe) {
    incrementUsage(userId, recipe.id)
  }

  registerRunningTask(userId, taskId, subtaskId, agentId, description)
  try {
    const result = await dispatchToAgent(assignee, description, {
      userId,
      taskId,
      subtaskId,
      domain,
      cwd,
      signal,
      resumeSession,
      onProgress: (progress) => {
        updateSubTask(userId, taskId, subtaskId, { progress })
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

function executeTaskInBackground(userId: string, taskId: string, subtasks: Array<{ name: string; description: string; assignee?: string; resumeSession?: string; domain?: string; cwd?: string }>) {
  ;(async () => {
    const task = getTask(userId, taskId)
    if (!task) return

    const controller = getOrCreateAbortController(taskId)
    const signal = controller.signal

    const resumeMap = new Map<string, string>()
    const domainMap = new Map<string, string>()
    const cwdMap = new Map<string, string>()
    for (const st of subtasks) {
      const assignee = st.assignee || 'general'
      const sub = addSubTask(userId, taskId, { name: st.name, description: st.description, assignee, domain: st.domain, cwd: st.cwd })
      if (st.resumeSession) {
        resumeMap.set(sub.id, st.resumeSession)
      }
      if (st.domain) domainMap.set(sub.id, st.domain)
      if (st.cwd) cwdMap.set(sub.id, st.cwd)
    }
    updateTask(userId, taskId, { status: 'executing' })

    let completed = 0
    while (true) {
      if (signal.aborted) break

      const currentTask = getTask(userId, taskId)
      if (currentTask?.status === 'cancelled') {
        controller.abort()
        break
      }

      const runnables = scheduleAllRunnable(userId, taskId)
      if (runnables.length === 0) break

      if (runnables.length > 1) {
        broadcast('progress', `⚡ 并行启动 ${runnables.length} 个子任务...`, userId)
      }

      const results = await Promise.allSettled(
        runnables.map(st => executeSubTask(userId, taskId, st.id, st.description, st.assignee, signal, resumeMap.get(st.id), domainMap.get(st.id), cwdMap.get(st.id)))
      )

      if (signal.aborted) break

      for (let i = 0; i < runnables.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
          handleSubTaskComplete(userId, taskId, runnables[i].id, r.value)
          completed++
          broadcast('progress', `✅ [${completed}/${subtasks.length}] ${runnables[i].name} — 完成`, userId)
          onTaskCompleted(userId)
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          handleSubTaskFailed(userId, taskId, runnables[i].id, errMsg)
          broadcast('progress', `❌ ${runnables[i].name} — 失败`, userId)
        }
      }
    }

    taskAbortControllers.delete(taskId)

    if (!signal.aborted) {
      try { evaluatePromotion(userId) } catch {}

      checkTaskCompletion(userId, taskId)
      const finalTask = getTask(userId, taskId)
      if (finalTask?.status === 'completed' && finalTask.result) {
        broadcast('progress', `正在为您整理汇报...`, userId)

        const reportPrompt = `你是 Jarvis，一个有幽默感的私人管家。称呼用户为 Sir。\n` +
          `你刚刚完成了任务「${finalTask.name}」。以下是团队交回的原始结果：\n\n${finalTask.result}\n\n` +
          `请向 Sir 汇报结果。要求：\n` +
          `- 直接输出汇报内容，不要输出 JSON\n` +
          `- 保留关键信息，去掉冗余\n` +
          `- 用清晰的结构（列表、表格都行）\n` +
          `- 语气像管家汇报，不是写文档\n` +
          `- 太长就给精华摘要，说一句"详细版随时可以展开"`

        const summary = await withBrainLock(userId, () => rawLlmCall(userId, reportPrompt, '请汇报'))
        const report = summary || finalTask.result
        broadcast('response', report, userId)
        addToBuffer(userId, 'jarvis', report)
      }
    }
  })().catch(err => {
    if (err?.message?.includes('取消')) return
    broadcast('response', `[错误] 任务执行异常: ${err instanceof Error ? err.message : String(err)}`, userId)
  })
}

export async function think(userId: string, userMessage: string, onProgress?: (text: string) => void, onDelta?: (text: string) => void): Promise<string> {
  const t0 = Date.now()
  debug('think() called:', userMessage.slice(0, 50))
  addToBuffer(userId, 'user', userMessage)

  const taskContext = getTaskSummary(userId)
  const recipes = listRecipes(userId)
  const teamInfo = recipes.map(r => `- ${r.name} (id: ${r.id}): ${r.description}`).join('\n')

  // 从 EverOS 检索相关记忆
  debug('searching memory...')
  onProgress?.('正在回忆相关信息...')
  const t1 = Date.now()
  const memories = await searchMemory(userId, userMessage, 5)
  console.log(`[perf] searchMemory: ${Date.now() - t1}ms`)
  debug('memory done, length:', memories.length)

  const recentConvo = getRecentConversation(userId)

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
  const t2 = Date.now()
  console.log(`[perf] prompt built, length: ${contextualPrompt.length} chars`)
  let accum = ''
  let codeBlockHit = false
  const filteredDelta = onDelta ? (text: string) => {
    if (codeBlockHit) return
    accum += text
    if (accum.includes('```')) {
      codeBlockHit = true
      return
    }
    onDelta(text)
  } : undefined
  const llmResponse = await llmCall(userId, contextualPrompt, filteredDelta)
  console.log(`[perf] llmCall: ${Date.now() - t2}ms`)
  console.log(`[perf] total think(): ${Date.now() - t0}ms`)

  const action = parseAction(llmResponse)

  if (!action) {
    const cleaned = llmResponse.replace(/```(?:json)?[\s\S]*?```/g, '').trim()
    const finalResponse = cleaned || llmResponse
    addToBuffer(userId, 'jarvis', finalResponse)
    saveConversation(userId, userMessage, finalResponse)
    return finalResponse
  }

  let response: string

  switch (action.action) {
    case 'create_task': {
      const { name, description, subtasks } = action.data as {
        name: string
        description: string
        subtasks?: Array<{ name: string; description: string; assignee?: string; resumeSession?: string; domain?: string; cwd?: string }>
      }
      const task = createTask(userId, name, description)
      updateTask(userId, task.id, { status: 'planning' })

      const preamble = llmResponse.split('```json')[0].trim()

      if (subtasks && subtasks.length > 0) {
        const subtaskList = subtasks.map((st, i) => `  ${i + 1}. ${st.name}`).join('\n')
        response = preamble
          ? `${preamble}\n\n执行计划：\n${subtaskList}\n\n正在后台执行，有进展会通知您。`
          : `明白，Sir。已创建任务「${name}」，计划：\n${subtaskList}\n\n正在后台执行，有进展会通知您。`

        executeTaskInBackground(userId, task.id, subtasks)
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
        const activeTasks = listTasks(userId).filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
        for (const t of activeTasks) {
          updateTask(userId, t.id, { status: 'cancelled' })
          abortTask(t.id)
        }
        response = `已取消全部 ${activeTasks.length} 个任务，Sir。${reason ? `原因：${reason}` : ''}`
      } else {
        const task = getTask(userId, taskId)
        if (!task) {
          const activeTasks = listTasks(userId).filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
          if (activeTasks.length > 0) {
            for (const t of activeTasks) {
              updateTask(userId, t.id, { status: 'cancelled' })
              abortTask(t.id)
            }
            response = `已取消全部 ${activeTasks.length} 个活跃任务，Sir。`
          } else {
            response = '当前没有可取消的任务，Sir。'
          }
        } else {
          updateTask(userId, taskId, { status: 'cancelled' })
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
        broadcast('progress', `💬 Jarvis → Agent: ${msg.slice(0, 40)}`, userId)
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

  onMessageHandled(userId)
  addToBuffer(userId, 'jarvis', response)
  saveConversation(userId, userMessage, response)
  return response
}

interface ConversationTurn {
  role: 'user' | 'jarvis'
  content: string
  timestamp: number
}

const MAX_BUFFER_TURNS = 20
const CONVERSATION_TTL = 4 * 60 * 60 * 1000 // 4小时过期

function getOrCreateSession(userId: string): string {
  const row = db.prepare(`
    SELECT id, updated_at FROM user_jarvis_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(userId) as any

  if (row) {
    const lastUpdate = new Date(row.updated_at).getTime()
    if (Date.now() - lastUpdate < CONVERSATION_TTL) {
      return row.id
    }
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO user_jarvis_sessions (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, userId, now, now)
  return id
}

function addToBuffer(userId: string, role: 'user' | 'jarvis', content: string) {
  const sessionId = getOrCreateSession(userId)
  const now = Date.now()

  db.prepare('INSERT INTO user_jarvis_messages (session_id, user_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(sessionId, userId, role, content, now)
  db.prepare('UPDATE user_jarvis_sessions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId)

  // Keep max N turns per session
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM user_jarvis_messages WHERE session_id = ?').get(sessionId) as any).cnt
  if (count > MAX_BUFFER_TURNS) {
    db.prepare(`
      DELETE FROM user_jarvis_messages WHERE id IN (
        SELECT id FROM user_jarvis_messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?
      )
    `).run(sessionId, count - MAX_BUFFER_TURNS)
  }
}

function getRecentConversation(userId: string): string {
  const sessionId = getOrCreateSession(userId)
  const rows = db.prepare(`
    SELECT role, content FROM user_jarvis_messages WHERE session_id = ? ORDER BY timestamp ASC
  `).all(sessionId) as any[]

  if (rows.length === 0) return ''
  // 喂给 LLM 前 redact 敏感 token —— db 里原文保留供用户回看
  return rows
    .map((t: any) => `${t.role === 'user' ? 'Sir' : 'Jarvis'}: ${redactSecrets(t.content)}`)
    .join('\n')
}

function saveConversation(userId: string, userMessage: string, jarvisResponse: string) {
  const sessionId = `jarvis-${userId}`
  const now = Date.now()
  // 发去 EverOS 长记忆前 redact 敏感 token —— db 聊天表里原文保留
  addMemory(userId, sessionId, [
    { role: 'user', timestamp: now, content: redactSecrets(userMessage) },
    { role: 'assistant', timestamp: now + 100, content: redactSecrets(jarvisResponse) },
  ]).catch(() => {})
}
