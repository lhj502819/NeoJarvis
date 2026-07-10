import { createTask, updateTask, addSubTask, getTask, getTaskSummary, listTasks, updateSubTask } from '../task/manager.js'
import { scheduleAllRunnable, handleSubTaskComplete, handleSubTaskFailed, checkTaskCompletion } from '../task/scheduler.js'
import { listRecipes, getRecipe, incrementUsage } from '../team/registry.js'
import { dispatchToAgent, interruptAgent } from '../a2a/client.js'
import { registerRunningTask, unregisterRunningTask } from '../a2a/registry.js'
import { bus } from '../a2a/bus.js'
import { broadcast } from './sse.js'
import { buildSubtaskEvent } from './subtask-event.js'
import { consumeArtifact } from './tools.js'
import { onMessageHandled, onTaskCompleted } from './state.js'
import { withBrainLock, rawLlmCall } from './llm.js'
import { addToBuffer, saveArtifact } from './conversation.js'
import { onShutdown } from './lifecycle.js'

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

onShutdown(() => {
  for (const [id, controller] of taskAbortControllers) {
    controller.abort()
  }
  taskAbortControllers.clear()
})

export function parseAction(text: string): ActionResponse | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  const braceMatch = text.match(/\{[\s\S]*"action"\s*:\s*"[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0].trim())
    } catch {}
  }

  return null
}

async function executeSubTask(userId: string, taskId: string, subtaskId: string, description: string, assignee: string, signal: AbortSignal, resumeSession?: string, domain?: string, cwd?: string): Promise<string> {
  if (signal.aborted) throw new Error('任务已取消')

  const recipe = await getRecipe(userId, assignee)
  const agentId = recipe ? recipe.id : `adhoc-${subtaskId.slice(0, 6)}`

  if (recipe) {
    await incrementUsage(userId, recipe.id)
  }

  registerRunningTask(userId, taskId, subtaskId, agentId, description)
  const startedAtMs = Date.now()
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
        updateSubTask(userId, taskId, subtaskId, { progress: progress.text }).catch(() => {})
        const payload = buildSubtaskEvent({
          subtaskId, taskId,
          agentName: recipe?.name || assignee,
          taskName: description.slice(0, 60),
          status: 'running',
          turnCount: progress.turnCount,
          currentAction: progress.currentAction,
          currentTool: progress.currentTool,
          startedAt: startedAtMs,
        })
        broadcast('subtask', JSON.stringify(payload), userId)
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

export function executeTaskInBackground(userId: string, taskId: string, subtasks: Array<{ name: string; description: string; assignee?: string; resumeSession?: string; domain?: string; cwd?: string }>) {
  ;(async () => {
    const task = await getTask(userId, taskId)
    if (!task) return

    const controller = getOrCreateAbortController(taskId)
    const signal = controller.signal

    const resumeMap = new Map<string, string>()
    const domainMap = new Map<string, string>()
    const cwdMap = new Map<string, string>()
    for (const st of subtasks) {
      const assignee = st.assignee || 'general'
      const sub = await addSubTask(userId, taskId, { name: st.name, description: st.description, assignee, domain: st.domain, cwd: st.cwd })
      if (st.resumeSession) {
        resumeMap.set(sub.id, st.resumeSession)
      }
      if (st.domain) domainMap.set(sub.id, st.domain)
      if (st.cwd) cwdMap.set(sub.id, st.cwd)
    }
    await updateTask(userId, taskId, { status: 'executing' })

    let completed = 0
    while (true) {
      if (signal.aborted) break

      const currentTask = await getTask(userId, taskId)
      if (currentTask?.status === 'cancelled') {
        controller.abort()
        break
      }

      const runnables = await scheduleAllRunnable(userId, taskId)
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
        const st = runnables[i]
        // 拿 agent 名(有 recipe 用 recipe.name,否则用 assignee)
        const recipe = await getRecipe(userId, st.assignee)
        const agentName = recipe?.name || st.assignee
        if (r.status === 'fulfilled') {
          await handleSubTaskComplete(userId, taskId, st.id, r.value)
          completed++
          broadcast('progress', `✅ [${completed}/${subtasks.length}] ${st.name} — 完成`, userId)
          broadcast('subtask', JSON.stringify(buildSubtaskEvent({
            subtaskId: st.id, taskId,
            agentName, taskName: st.name,
            status: 'done', turnCount: 0,  // turnCount 前端已从 running 事件累积到最终值,此处不需要精确
          })), userId)
          await onTaskCompleted(userId)
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          await handleSubTaskFailed(userId, taskId, st.id, errMsg)
          broadcast('progress', `❌ ${st.name} — 失败`, userId)
          broadcast('subtask', JSON.stringify(buildSubtaskEvent({
            subtaskId: st.id, taskId,
            agentName, taskName: st.name,
            status: 'failed', turnCount: 0, error: errMsg,
          })), userId)
        }
      }
    }

    taskAbortControllers.delete(taskId)

    if (!signal.aborted) {
      await checkTaskCompletion(userId, taskId)
      const finalTask = await getTask(userId, taskId)
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
        await addToBuffer(userId, 'jarvis', report)
      }
    }
  })().catch(err => {
    if (err?.message?.includes('取消')) return
    broadcast('response', `[错误] 任务执行异常: ${err instanceof Error ? err.message : String(err)}`, userId)
  })
}

export async function dispatchAction(
  userId: string,
  action: ActionResponse,
  llmResponse: string,
  userMessage: string
): Promise<{ response: string; artifact?: any }> {
  let response: string

  switch (action.action) {
    case 'create_task': {
      const { name, description, subtasks } = action.data as {
        name: string
        description: string
        subtasks?: Array<{ name: string; description: string; assignee?: string; resumeSession?: string; domain?: string; cwd?: string }>
      }
      const task = await createTask(userId, name, description)
      await updateTask(userId, task.id, { status: 'planning' })

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
        const activeTasks = (await listTasks(userId)).filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
        for (const t of activeTasks) {
          await updateTask(userId, t.id, { status: 'cancelled' })
          abortTask(t.id)
        }
        response = `已取消全部 ${activeTasks.length} 个任务，Sir。${reason ? `原因：${reason}` : ''}`
      } else {
        const task = await getTask(userId, taskId)
        if (!task) {
          const activeTasks = (await listTasks(userId)).filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
          if (activeTasks.length > 0) {
            for (const t of activeTasks) {
              await updateTask(userId, t.id, { status: 'cancelled' })
              abortTask(t.id)
            }
            response = `已取消全部 ${activeTasks.length} 个活跃任务，Sir。`
          } else {
            response = '当前没有可取消的任务，Sir。'
          }
        } else {
          await updateTask(userId, taskId, { status: 'cancelled' })
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

  await onMessageHandled(userId)
  const artifact = consumeArtifact(userId)
  const artifactId = artifact ? await saveArtifact(userId, artifact) : undefined
  await addToBuffer(userId, 'jarvis', response, artifactId)

  return { response, artifact: artifact || undefined }
}
