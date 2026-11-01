import { createTask, updateTask, addSubTask, getTask, getTaskSummary, listTasks, updateSubTask, getActiveTasks, cleanupStaleTasks } from '../task/manager.js'
import { scheduleAllRunnable, handleSubTaskComplete, handleSubTaskFailed, checkTaskCompletion } from '../task/scheduler.js'
import { listRecipes, getRecipe, incrementUsage } from '../team/registry.js'
import { dispatchToAgent, interruptAgent, takeWrittenFiles } from '../a2a/client.js'
import { listAdhocAgents } from '../a2a/adhoc.js'
import { registerRunningTask, unregisterRunningTask, getRunningSubtasksForTask, updateRunningTaskProgress } from '../a2a/registry.js'
import { bus } from '../a2a/bus.js'
import { broadcast } from './sse.js'
import { buildSubtaskEvent } from './subtask-event.js'
import { sanitizeCwd } from './cwd-guard.js'
import { consumeArtifact } from './tools.js'
import { onMessageHandled, onTaskCompleted } from './state.js'
import { withBrainLock, rawLlmCall } from './llm.js'
import { addToBuffer, saveArtifact } from './conversation.js'
import { onShutdown } from './lifecycle.js'
import { readFileSync, statSync } from 'fs'
import { extname, basename } from 'path'
import type { PendingArtifact } from './tools.js'

// 成品文件扩展名 → 预览类型。只挑"可展示的成品",不含中间代码文件。
const PREVIEW_EXT: Record<string, PendingArtifact['type']> = {
  '.html': 'html', '.htm': 'html',
  '.md': 'markdown', '.markdown': 'markdown',
  '.mmd': 'mermaid', '.mermaid': 'mermaid',
}
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

// 从小弟写过的文件里确定性挑一个主成品,读出来建预览 artifact。
// 优先级:html > markdown > mermaid;同类取最后写的(通常是最终成品)。
export function buildPreviewFromFiles(files: string[]): PendingArtifact | null {
  const pick = (types: Array<PendingArtifact['type']>) => {
    for (let i = files.length - 1; i >= 0; i--) {
      const t = PREVIEW_EXT[extname(files[i]).toLowerCase()]
      if (t && types.includes(t)) return files[i]
    }
    return null
  }
  const path = pick(['html']) || pick(['markdown']) || pick(['mermaid'])
  if (!path) return null
  try {
    if (statSync(path).size > PREVIEW_MAX_BYTES) return null
    const content = readFileSync(path, 'utf-8')
    if (!content.trim()) return null
    return {
      type: PREVIEW_EXT[extname(path).toLowerCase()],
      title: basename(path),
      content,
    }
  } catch {
    return null
  }
}

interface ActionResponse {
  action: string
  data: Record<string, unknown>
}

// 任务完成后,算出本次涉及的领域里"该转正"的临时工(累计 ≥3 次、尚未转正),
// 生成一段汇报附言让 Jarvis 主动向 Sir 推荐收编。只看本任务干过的 domain。
// 拿不到数据 / 无候选 → 返回空串,汇报里就不提。
async function buildPromoteNote(
  userId: string,
  subtasks: Array<{ domain?: string }>,
): Promise<string> {
  const touchedDomains = new Set(subtasks.map(st => st.domain).filter((d): d is string => !!d))
  if (touchedDomains.size === 0) return ''

  const adhocs = await listAdhocAgents(userId)  // 已按 promoted=0 过滤
  const ready = adhocs.filter(a => touchedDomains.has(a.domain) && a.taskCount >= 3)
  if (ready.length === 0) return ''

  const list = ready.map(a => `「${a.domain}」(已干 ${a.taskCount} 次)`).join('、')
  return `\n\n【主动推荐转正】本次涉及的 ${list} 领域,临时工已累计达转正线。` +
    `请在汇报末尾自然地顺带向 Sir 推荐把他转正为正式小弟 —— 按 promote-agent skill 的做法,` +
    `简短说明理由 + 给他起个拟人昵称和 emoji,让 Sir 一句话决定。别生硬,像同事间顺口提一嘴。`
}

const taskAbortControllers: Map<string, AbortController> = new Map()

export function abortTask(taskId: string) {
  // 取消不走小弟的正常完成流程,得主动收尾两件事,否则前端和 DB 都留残影:
  //  ① 给前端补发结束事件 —— 否则 MonitorPanel 里那条 running 会一直挂到页面刷新。
  //  ② 把运行中子任务标记 cancelled —— cancel_task 只改了任务表,子任务会永远停在 running。
  // 用 failed + error='已取消'(前端对非 running 一视同仁:立即结束态、30s 后淡出),
  // 避免为取消新增一套状态枚举;子任务侧则落 'cancelled' 语义。
  for (const st of getRunningSubtasksForTask(taskId)) {
    broadcast('subtask', JSON.stringify(buildSubtaskEvent({
      subtaskId: st.subtaskId, taskId,
      agentName: st.agentName, agentType: st.agentType,
      taskName: st.description.slice(0, 60),
      status: 'failed', turnCount: 0,
      startedAt: st.startedAt, error: '已取消',
    })), st.userId)
    // fire-and-forget:不阻塞取消,更新失败也不影响 abort(DB 偶发失败可容忍)
    updateSubTask(st.userId, taskId, st.subtaskId, { status: 'cancelled', error: '已取消' }).catch(() => {})
    // ③ 立即从内存 registry 摘除 —— 否则会滞留到 executeSubTask 的 finally(要等 SDK abort
    //    冒泡返回,有延迟)。窗口期内切 tab / 重挂 MonitorPanel 会 fetch /api/agents 读到这条
    //    残影,把已取消的任务又渲染成"执行中"。finally 里的 unregister 幂等,留作兜底。
    unregisterRunningTask(st.subtaskId)
  }
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

async function executeSubTask(userId: string, taskId: string, subtaskId: string, description: string, assignee: string, signal: AbortSignal, resumeSubtaskId?: string, domain?: string, cwd?: string, skills?: string[]): Promise<string> {
  if (signal.aborted) throw new Error('任务已取消')

  const recipe = await getRecipe(userId, assignee)
  const agentId = recipe ? recipe.id : `adhoc-${subtaskId.slice(0, 6)}`

  if (recipe) {
    await incrementUsage(userId, recipe.id)
  }

  registerRunningTask(userId, taskId, subtaskId, agentId, description, recipe ? 'permanent' : 'adhoc', recipe?.name || assignee)
  const startedAtMs = Date.now()
  // 启动即广播一条 running 事件,让前端监控卡立刻出现 —— 否则第一条 subtask 事件要等
  // onProgress(小弟首个 assistant 消息)才发,而 extended thinking 的首 token 常要几十秒到
  // 几分钟,导致卡片迟迟不弹、非刷新不可见。MonitorPanel 按 subtaskId 合并,后续 onProgress
  // 只更新同一张卡的回合数/工具,不会重复。
  broadcast('subtask', JSON.stringify(buildSubtaskEvent({
    subtaskId, taskId,
    agentName: recipe?.name || assignee,
    agentType: recipe ? 'permanent' : 'adhoc',
    taskName: description.slice(0, 60),
    status: 'running',
    turnCount: 0,
    startedAt: startedAtMs,
  })), userId)
  try {
    const result = await dispatchToAgent(assignee, description, {
      userId,
      taskId,
      subtaskId,
      domain,
      cwd,
      skills,
      signal,
      resumeSubtaskId,
      onProgress: (progress) => {
        updateSubTask(userId, taskId, subtaskId, { progress: progress.text }).catch(() => {})
        // 同步实时进度到 registry,让前端刷新后能从 /api/agents 拿到真实回合数(而非重置为 0)
        updateRunningTaskProgress(subtaskId, progress.turnCount, progress.currentTool)
        const payload = buildSubtaskEvent({
          subtaskId, taskId,
          agentName: recipe?.name || assignee,
          agentType: recipe ? 'permanent' : 'adhoc',
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

// 任务结算后,让 Jarvis 生成一段汇报推给 Sir。completed / failed 都要汇报 —— 全军覆没也得
// 明确告诉用户"这活儿没成、卡在哪",别静默。抽成独立函数供两处复用:正常后台跑完(executeTaskInBackground)、
// 进程重启恢复(recoverInterruptedTasks)。幂等由调用方保证(只在刚结算的任务上调一次)。
// 导出仅为单测直接覆盖其"必定落库/兜底"契约。
export async function finalizeAndReport(userId: string, taskId: string): Promise<void> {
  const finalTask = await getTask(userId, taskId)
  if (!finalTask) return
  // 只汇报已结算(completed/failed)且有内容的任务;仍在跑 / 已取消的不在这里报。
  if (finalTask.status !== 'completed' && finalTask.status !== 'failed') return
  if (!finalTask.result) return

  const failed = finalTask.status === 'failed'
  broadcast('progress', failed ? `任务未能完成,正在为您说明情况...` : `正在为您整理汇报...`, userId)

  // 确定性挑成品预览:汇总本任务所有子任务写过的文件,代码层面挑主成品,
  // 不靠 LLM 主动调 render_preview(它会偷懒/幻觉"已推送预览"却没真调)
  const producedFiles = finalTask.subtasks.flatMap(st => takeWrittenFiles(st.id))
  const autoArtifact = buildPreviewFromFiles(producedFiles)

  const previewNote = autoArtifact
    ? `\n\n【已自动预览】团队产出的成品「${autoArtifact.title}」已推送到右侧预览面板,汇报时可以自然提一句"已在右侧预览"。`
    : ''

  // 主动推荐转正:本次任务涉及的领域里,若有临时工累计达线(≥3 次且未转正),
  // 把推荐指令拼进汇报 prompt —— Jarvis 汇报完顺口提一句,不用 Sir 开口问。
  // 只看本任务干过的 domain(刚干完活、顺势推荐的自然时机),不翻无关历史候选。
  // 全军覆没(failed)时不推荐转正 —— 没干成就别顺带请功。
  const promoteNote = failed ? '' : await buildPromoteNote(userId, finalTask.subtasks).catch(() => '')

  const intro = failed
    ? `你刚安排的任务「${finalTask.name}」没能顺利完成 —— 团队部分或全部环节失败/中断了。以下是各环节的原始情况(含失败原因):`
    : `你刚刚完成了任务「${finalTask.name}」。以下是团队交回的原始结果:`
  const extraReq = failed
    ? `- 如实说明哪些环节没成、卡在哪,别粉饰;能补救就给下一步建议\n`
    : ''

  const reportPrompt = `你是 Jarvis，一个有幽默感的私人管家。称呼用户为 Sir。\n` +
    `${intro}\n\n${finalTask.result}\n\n` +
    `请向 Sir 汇报结果。要求：\n` +
    `- 直接输出汇报内容，不要输出 JSON\n` +
    `- 保留关键信息，去掉冗余\n` +
    extraReq +
    `- 用清晰的结构（列表、表格都行）\n` +
    `- 语气像管家汇报，不是写文档\n` +
    `- 太长就给精华摘要，说一句"详细版随时可以展开"${previewNote}${promoteNote}`

  // 汇报的 LLM 调用套超时 + 可中断。背景:任务结算瞬间常有多个 claude 并发 spawn(小弟结尾的
  // message_jarvis 回复 + 这条汇报),实测出现过汇报 rawLlmCall 起了头就永不返回、日志冻结数小时。
  // 若不设超时:① withBrainLock 的 .finally(resolve) 永不执行 → 该 user 的脑锁被永久占死 → 之后
  // 所有汇报(含重启恢复那条路)全部死锁;② 用户永远等不到汇报。超时 abort 让 SDK 的 for-await 结束
  // → rawLlmCall 返回/抛 → 锁一定释放。REPORT 独立日志,方便下次定位(这次就是因无独立日志靠通用 perf 行反推)。
  const REPORT_TIMEOUT_MS = 120_000
  console.log(`[perf] report start, task=${taskId} status=${finalTask.status}`)
  let summary = ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REPORT_TIMEOUT_MS)
  try {
    summary = await withBrainLock(userId, () => rawLlmCall(userId, reportPrompt, '请汇报', undefined, undefined, ac))
  } catch (err) {
    // 超时/spawn 失败/流早结束都吞掉走兜底 —— 绝不让汇报这一步把整个任务收尾流程带崩(否则会冒泡到
    // executeTaskInBackground 的外层 catch,那里只 broadcast SSE-only 的 task-error、不落库 → 静默)。
    console.log(`[perf] report LLM failed/timeout, fallback to raw result: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }

  // 兜底:LLM 空/失败也必定有内容发出。退回 finalTask.result(已聚合各子任务产出,Fix A 保证非空),
  // 并点明"自动汇报生成失败" —— 宁可给原始结果,也绝不静默。
  const report = summary.trim()
    || `Sir，任务「${finalTask.name}」已${failed ? '结束（部分环节未成）' : '完成'}。自动汇报这步没生成出来，先把团队交回的原始结果原样给您：\n\n${finalTask.result}`
  console.log(`[perf] report done, task=${taskId} llm=${summary.trim() ? 'ok' : 'fallback'} len=${report.length}`)

  // 落库是唯一持久化路径(broadcast 仅 SSE、页面不在就丢)。整段保护:任一步抛也要保证 addToBuffer 执行到,
  // 只要走进 finalizeAndReport,聊天里必有一条 jarvis 汇报。
  try {
    // 优先用确定性挑出的成品;若无,兜底看 LLM 是否手动 render_preview 过
    const artifact = autoArtifact || consumeArtifact(userId)
    const artifactId = artifact ? await saveArtifact(userId, artifact, taskId).catch(() => undefined) : undefined
    broadcast('response', report, userId, 'task-report')
    if (artifact) broadcast('artifact', JSON.stringify(artifact), userId, 'task-report')
    await addToBuffer(userId, 'jarvis', report, artifactId)
  } catch (err) {
    // 连 artifact/broadcast 都抛了也别放弃落库 —— 最后再兜一次纯文本汇报进库。
    console.log(`[perf] report persist failed, retry addToBuffer text-only: ${err instanceof Error ? err.message : String(err)}`)
    await addToBuffer(userId, 'jarvis', report).catch(() => {})
  }
}

// ── 进程重启恢复 ──
// 汇报逻辑整个长在 executeTaskInBackground 的内存循环里,进程一重启(热重载/手动重启)循环直接
// 死掉:小弟哪怕真干完了,checkTaskCompletion + 汇报也永不执行,任务永远停在 executing。旧行为
// 是下次请求进来 cleanupStaleTasks 把它盲判 cancelled —— 静默、还把已完成的活儿当取消。
//
// 这里在进程启动时先扫一遍该用户"卡在 executing/planning"的任务,分两种收场:
//   ① 子任务已全终态(小弟真跑完了,只是没人结算)→ checkTaskCompletion 结算 + finalizeAndReport 补汇报。
//   ② 还有子任务在 running/pending(真被打断)→ cleanupStaleTasks 落 cancelled,并明确告诉 Sir 中断了。
// 必须跑在 cleanupStaleTasks(auth middleware 首次请求触发)之前,否则任务已被盲改成 cancelled、无从区分。
const recoveredUsers = new Set<string>()
const NON_TERMINAL_SUBTASK = ['pending', 'running', 'input-required']

export async function recoverInterruptedTasks(userId: string): Promise<void> {
  if (recoveredUsers.has(userId)) return
  recoveredUsers.add(userId)
  try {
    const active = await getActiveTasks(userId)  // status NOT IN (completed/failed/cancelled)
    const stuck = active.filter(t => (t.status === 'executing' || t.status === 'planning') && t.subtasks.length > 0)

    let interrupted = 0
    for (const t of stuck) {
      const anyLive = t.subtasks.some(st => NON_TERMINAL_SUBTASK.includes(st.status))
      if (anyLive) {
        // 真被打断:小弟进程已随主进程一起没了,活儿续不上。计数,稍后由 cleanupStaleTasks 统一落 cancelled。
        interrupted++
        continue
      }
      // 小弟已全部跑完(completed/failed/cancelled),只是上次没人结算 → 现在补上 + 补汇报。
      const settled = await checkTaskCompletion(userId, t.id).catch(() => false)
      if (settled) await finalizeAndReport(userId, t.id).catch(() => {})
    }

    // 兜底清理:落下的被打断任务(executing/planning→cancelled、running/pending 子任务→cancelled)统一由它收拾。
    // 恒调 —— 保持旧 cleanupStaleTasks 的全部安全网语义(如"planning 且无子任务"的半截任务);已被上面
    // 结算成 completed/failed 的任务是终态,cleanupStaleTasks 只碰非终态,不会误伤。
    await cleanupStaleTasks(userId).catch(() => {})

    if (interrupted > 0) {
      broadcast('response',
        `Sir，服务刚重启过，有 ${interrupted} 个正在执行的任务被中断了,已标记取消。需要的话我可以重新安排。`,
        userId, 'task-error')
    }
  } catch {
    // 恢复是尽力而为,拉不到任务 / DB 抖动都不该阻塞启动。兜底退回旧行为。
    await cleanupStaleTasks(userId).catch(() => {})
  }
}

export function executeTaskInBackground(userId: string, taskId: string, subtasks: Array<{ name: string; description: string; assignee?: string; resumeSubtaskId?: string; domain?: string; cwd?: string; skills?: string[] }>) {
  ;(async () => {
    const task = await getTask(userId, taskId)
    if (!task) return

    const controller = getOrCreateAbortController(taskId)
    const signal = controller.signal

    const resumeMap = new Map<string, string>()
    const domainMap = new Map<string, string>()
    const cwdMap = new Map<string, string>()
    const skillsMap = new Map<string, string[]>()
    for (const st of subtasks) {
      const assignee = st.assignee || 'general'
      // 防线:Jarvis 可能幻觉出不存在的 cwd(如错误用户名 /Users/hh/...)。
      // 校验后不存在的路径丢弃,广播提示,避免 spawn ENOENT 被 SDK 误包装成 libc 错误。
      const safeCwd = sanitizeCwd(st.cwd)
      if (st.cwd && !safeCwd) {
        broadcast('progress', `⚠️ 忽略无效 cwd "${st.cwd}"(路径不存在),小弟改到用户工作区执行`, userId)
      }
      const sub = await addSubTask(userId, taskId, { name: st.name, description: st.description, assignee, domain: st.domain, cwd: safeCwd })
      if (st.resumeSubtaskId) {
        resumeMap.set(sub.id, st.resumeSubtaskId)
      }
      if (st.domain) domainMap.set(sub.id, st.domain)
      if (safeCwd) cwdMap.set(sub.id, safeCwd)
      if (st.skills?.length) skillsMap.set(sub.id, st.skills)
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
        runnables.map(st => executeSubTask(userId, taskId, st.id, st.description, st.assignee, signal, resumeMap.get(st.id), domainMap.get(st.id), cwdMap.get(st.id), skillsMap.get(st.id)))
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
            agentName, agentType: recipe ? 'permanent' : 'adhoc',
            taskName: st.name,
            status: 'done', turnCount: 0,
          })), userId)
          await onTaskCompleted(userId)
        } else {
          const errMsg = r.reason?.message || 'unknown'
          if (errMsg.includes('取消')) continue
          await handleSubTaskFailed(userId, taskId, st.id, errMsg)
          broadcast('progress', `❌ ${st.name} — 失败`, userId)
          broadcast('subtask', JSON.stringify(buildSubtaskEvent({
            subtaskId: st.id, taskId,
            agentName, agentType: recipe ? 'permanent' : 'adhoc',
            taskName: st.name,
            status: 'failed', turnCount: 0, error: errMsg,
          })), userId)
        }
      }
    }

    taskAbortControllers.delete(taskId)

    if (!signal.aborted) {
      await checkTaskCompletion(userId, taskId)
      await finalizeAndReport(userId, taskId)
    }
  })().catch(err => {
    if (err?.message?.includes('取消')) return
    broadcast('response', `[错误] 任务执行异常: ${err instanceof Error ? err.message : String(err)}`, userId, 'task-error')
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
        subtasks?: Array<{ name: string; description: string; assignee?: string; resumeSubtaskId?: string; domain?: string; cwd?: string }>
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
      // 无论 agent 是否在线,都持久化消息(前端可展示、agent 恢复时可读)
      bus.notify(userId, 'jarvis', subtaskId, subtaskId, msg)
      if (bus.isRegistered(subtaskId)) {
        response = `已把消息发给 agent (${subtaskId.slice(0, 6)})：「${msg.slice(0, 40)}」`
      } else {
        response = `消息已记录(agent 当前不在线,下次恢复时可读)：「${msg.slice(0, 40)}」`
      }
      broadcast('progress', `💬 Jarvis → Agent: ${msg.slice(0, 40)}`, userId)
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
