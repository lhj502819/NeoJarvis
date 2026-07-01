import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { buildSystemPrompt } from './prompt.js'
import { createTask, updateTask, addSubTask, getTask, getTaskSummary, listTasks, updateSubTask } from '../task/manager.js'
import { scheduleNext, handleSubTaskComplete, handleSubTaskFailed } from '../task/scheduler.js'
import { listRecipes, getRecipe, createRecipe, incrementUsage } from '../team/registry.js'
import { startAgentServer } from '../team/factory.js'
import { dispatchToAgent } from '../a2a/client.js'
import { broadcast } from './agent.js'
import { searchMemory, addMemory } from '../memory/everos.js'
import { onMessageHandled, onTaskCompleted, onTaskFailed } from './state.js'

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()
const HOME_DIR = homedir()

interface ActionResponse {
  action: string
  data: Record<string, unknown>
}

function parseAction(text: string): ActionResponse | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (!jsonMatch) return null
  try {
    return JSON.parse(jsonMatch[1].trim())
  } catch {
    return null
  }
}

async function llmCall(prompt: string): Promise<string> {
  const systemPrompt = buildSystemPrompt()
  let result = ''
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      pathToClaudeCodeExecutable: CLAUDE_PATH,
      cwd: HOME_DIR,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
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
  return result
}

async function executeSubTask(taskId: string, subtaskId: string, description: string, assignee: string): Promise<string> {
  const recipe = getRecipe(assignee)
  if (!recipe) return `错误: 找不到角色 ${assignee}`

  incrementUsage(recipe.id)
  startAgentServer(recipe)
  await new Promise(resolve => setTimeout(resolve, 500))

  try {
    const result = await dispatchToAgent(recipe.id, description)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (subtaskId) handleSubTaskFailed(taskId, subtaskId, msg)
    return `执行失败: ${msg}`
  }
}

function executeTaskInBackground(taskId: string, subtasks: Array<{ name: string; description: string; assignee?: string }>, onProgress: (text: string) => void) {
  ;(async () => {
    const task = getTask(taskId)
    if (!task) return

    for (const st of subtasks) {
      const assignee = st.assignee || 'general'
      addSubTask(taskId, { name: st.name, description: st.description, assignee })
    }
    updateTask(taskId, { status: 'executing' })

    let idx = 1
    let next = scheduleNext(taskId)
    while (next) {
      onProgress(`⏳ [${idx}/${subtasks.length}] 正在执行: ${next.name}`)
      broadcast('progress', `⏳ [${idx}/${subtasks.length}] 正在执行: ${next.name}`)

      const result = await executeSubTask(taskId, next.id, next.description, next.assignee)
      handleSubTaskComplete(taskId, next.id, result)

      onProgress(`✅ [${idx}/${subtasks.length}] ${next.name} — 完成`)
      broadcast('progress', `✅ [${idx}/${subtasks.length}] ${next.name} — 完成`)
      onTaskCompleted()

      idx++
      next = scheduleNext(taskId)
    }

    const finalTask = getTask(taskId)
    if (finalTask?.status === 'completed') {
      broadcast('response', `Sir, 任务「${finalTask.name}」已全部完成。`)
    }
  })().catch(err => {
    broadcast('response', `[错误] 任务执行异常: ${err instanceof Error ? err.message : String(err)}`)
  })
}

export async function think(userMessage: string, onProgress?: (text: string) => void): Promise<string> {
  const taskContext = getTaskSummary()
  const recipes = listRecipes()
  const teamInfo = recipes.map(r => `- ${r.name} (id: ${r.id}): ${r.description}`).join('\n')

  // 从 EverOS 检索相关记忆
  onProgress?.('正在回忆相关信息...')
  const memories = await searchMemory(userMessage, 5)

  const contextualPrompt = `## 当前任务状态
${taskContext}

## 可用团队成员
${teamInfo || '暂无团队成员'}

${memories ? `## 关于 Sir 的记忆\n${memories}\n` : ''}
## 用户消息
${userMessage}`

  onProgress?.('正在分析你的需求...')
  const llmResponse = await llmCall(contextualPrompt)

  const action = parseAction(llmResponse)

  if (!action) {
    // 存储对话到记忆
    saveConversation(userMessage, llmResponse)
    return llmResponse
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

        executeTaskInBackground(task.id, subtasks, onProgress || (() => {}))
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
        }
        response = `已取消全部 ${activeTasks.length} 个任务，Sir。${reason ? `原因：${reason}` : ''}`
      } else {
        const task = getTask(taskId)
        if (!task) {
          const activeTasks = listTasks().filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
          if (activeTasks.length > 0) {
            for (const t of activeTasks) {
              updateTask(t.id, { status: 'cancelled' })
            }
            response = `已取消全部 ${activeTasks.length} 个活跃任务，Sir。`
          } else {
            response = '当前没有可取消的任务，Sir。'
          }
        } else {
          updateTask(taskId, { status: 'cancelled' })
          response = `已取消任务「${task.name}」，Sir。`
        }
      }
      break
    }

    case 'ask_user': {
      response = (action.data as { question: string }).question
      break
    }

    default: {
      const cleanResponse = llmResponse.replace(/```json[\s\S]*?```/, '').trim()
      response = cleanResponse || llmResponse
    }
  }

  onMessageHandled()
  saveConversation(userMessage, response)
  return response
}

const sessionId = `jarvis-${Date.now()}`

function saveConversation(userMessage: string, jarvisResponse: string) {
  const now = Date.now()
  addMemory(sessionId, [
    { role: 'user', timestamp: now, content: userMessage },
    { role: 'assistant', timestamp: now + 100, content: jarvisResponse },
  ]).catch(() => {})
}
