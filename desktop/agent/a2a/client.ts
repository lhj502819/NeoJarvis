import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, getAgentDir, type ToolDefinition, type AgentSession } from '@earendil-works/pi-coding-agent'
import { getModelRuntime, getJarvisModel } from '../shared/pi-models.js'
import { getPeerAgents } from './registry.js'
import { getRecipe } from '../team/registry.js'
import { recordAgentSession, findLastSubtaskForReuse, extractKeywords } from './history.js'
import { upsertAdhocAgent } from './adhoc.js'
import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta } from '../task/manager.js'
import { bus } from './bus.js'
import { buildUserEnv } from '../shared/user-env.js'
import { getUserWorkspace } from '../shared/user-workspace.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'
import { createAgentCommsTools } from './agent-comms.js'
import { getSubtaskHistoryForPrompt } from './subtask-history-context.js'
import { getDisabledSkills, getEnabledHubSkills } from '../jarvis/skill-prefs.js'
import {
  recordToolTrace,
  flattenResultText,
} from '../shared/tool-trace.js'

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')
function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[agent-debug]\x1b[0m', ...args)
}

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
  resumeSubtaskId?: string
  skills?: string[]
  onProgress?: (progress: { text: string; turnCount: number; currentTool?: string; currentAction?: string }) => void
}


/**
 * 活跃小弟的 session 句柄。Pi 用 AgentSession 替代 Claude SDK 的 Query。
 *
 * 流式输入模式:Claude SDK 用 AsyncIterable<SDKUserMessage> + q.interrupt();
 * Pi 用 session.steer()(转向消息,当前 turn 工具跑完后投递)。
 * 中途打断用 session.abort()(替代 q.interrupt())。
 *
 * 生命周期:小弟 session.prompt() 完成 → agent_settled → 检查收件箱 → 有消息就再
 * prompt(steer 已投递);否则 close/dispose。
 */
interface ActiveAgent {
  session: AgentSession
  unsubscribe: () => void
}
const activeAgents = new Map<string, ActiveAgent>()

// ── InputQueue:保留导出(测试依赖),但 dispatchToAgent 不再使用 ──
// Pi 用 session.steer() 替代流式输入,InputQueue 仅作为纯数据结构留存供测试。
export interface InputQueue {
  push: (msg: any) => void
  close: () => void
  isDrained: () => boolean
  stream: AsyncGenerator<any>
}
export function createInputQueue(first: any): InputQueue {
  const pending: any[] = [first]
  let closed = false
  let wake: (() => void) | null = null
  const wakeup = () => { if (wake) { wake(); wake = null } }
  async function* gen(): AsyncGenerator<any> {
    while (true) {
      while (pending.length) yield pending.shift()!
      if (closed) return
      await new Promise<void>(resolve => { wake = resolve })
    }
  }
  return {
    push: (msg) => { if (!closed) { pending.push(msg); wakeup() } },
    close: () => { closed = true; wakeup() },
    isDrained: () => closed && pending.length === 0,
    stream: gen(),
  }
}

// 刚被"主动打断"的 subtask 集合。Jarvis 发消息时会 abort 小弟当前 turn,随后 session
// 会发 agent_end(willRetry=false)——这是预期的,不代表小弟结束。消费侧据此吸收掉,
// 让 steer 的消息在下一轮 prompt 生效。
const interruptedSubtasks = new Set<string>()

// 兼容旧 export(getActiveQuery):Pi 无 Query 对象,返回 undefined。
// routes/agent.ts 用 interruptAgent/closeAgent(已迁移到 session),不再需要 getActiveQuery。
export function getActiveQuery(_subtaskId: string): undefined {
  return undefined
}

// 小弟实际写过的文件路径(按写入顺序),供任务完成时确定性挑成品预览。
const writtenFilesMap = new Map<string, string[]>()
export function takeWrittenFiles(subtaskId: string): string[] {
  const files = writtenFilesMap.get(subtaskId) || []
  writtenFilesMap.delete(subtaskId)
  return files
}

/**
 * 给运行中的小弟投递一条消息。
 *
 * 迁移自 Claude SDK 的流式输入 push。Pi 用 session.steer():
 *   - steer 是"转向"消息,当前 turn 的工具调用跑完后投递(不像旧 interrupt 那么粗暴)
 *   - 不需要单独 interrupt —— steer 本身会让小弟下一轮看到新指令
 *
 * 注意:旧版靠 interrupt + push 配合实现"立即生效";Pi 的 steer 是"工具跑完后生效",
 * 语义上更温和,不会打断正在执行的工具调用。对小弟来说通常没问题(工具调用都很快)。
 */
export async function sendToAgent(subtaskId: string, message: string): Promise<boolean> {
  const ag = activeAgents.get(subtaskId)
  if (!ag) return false
  try {
    // steer 需要 session 处于 streaming 状态;如果小弟当前空闲(prompt 已完成),
    // 用 prompt() 重新发起一轮。
    if (ag.session.isStreaming) {
      await ag.session.steer(message)
    } else {
      await ag.session.prompt(message)
    }
    debug('sent message to agent:', subtaskId.slice(0, 6), message.slice(0, 40))
    return true
  } catch (err) {
    debug('failed to send to agent:', err)
    return false
  }
}

export async function interruptAgent(subtaskId: string): Promise<boolean> {
  const ag = activeAgents.get(subtaskId)
  if (!ag) return false
  try {
    interruptedSubtasks.add(subtaskId)
    await ag.session.abort()
    debug('interrupted agent:', subtaskId.slice(0, 6))
    return true
  } catch {
    interruptedSubtasks.delete(subtaskId)
    return false
  }
}

export function closeAgent(subtaskId: string): boolean {
  const ag = activeAgents.get(subtaskId)
  if (!ag) return false
  ag.unsubscribe()
  ag.session.dispose()
  activeAgents.delete(subtaskId)
  debug('closed agent:', subtaskId.slice(0, 6))
  return true
}

export async function dispatchToAgent(recipeId: string, taskDescription: string, context?: DispatchContext): Promise<string> {
  const userId = context?.userId || 'system'
  const recipe = await getRecipe(userId, recipeId)

  const adhocPrompt = `你是 Jarvis 团队里的一名干活的小弟,专门接手分配给你的这摊活儿。踏实干、把结果做扎实,该说话时像个活人一样开口。

## 沟通能力

你有以下沟通工具（agent-comms）:
- message_jarvis: 给管家 Jarvis 捎话(type: question | progress | deliverable | blocked)
- message_peer: 跟一起干活的其他小弟搭句话(异步,发完不用等)
- check_inbox: 看收件箱(Jarvis 的追加指令、其他小弟的消息/回复)。建议每几轮活儿主动瞄一次
- list_peers: 看看有哪些兄弟在跟你并肩干

何时开口、要不要开口,你自己拿捏。原则:信息不够就问,有风险就确认,能自己搞定就直接交付。
message_peer 发出去不用等,继续干;对方回了,下一轮 check_inbox 看到就行。`

  const agentName = recipe?.name || recipeId
  const talkLikeHuman = `

## 沟通时说人话(重要)
你在和 Jarvis、和其他小弟沟通时,像一个真同事那样说话,别像客服机器人或写公文:
- **口语、简短、直给**。想说啥直接说,别绕。"这块我卡住了,缺 XX""搞定,发你了""这里我有个不同看法"——就这样。
- **不要**用"现汇报如下""请知悉""收到,即刻执行""特此说明"这类腔调;**不要**动不动就分点罗列、加一堆小标题。一两句能说清就一两句。
- 和其他小弟说话,你们是并肩干活的搭子,可以随意点、有点性子:该催就催,该吐槽就吐槽,该夸就夸。别端着。
- 有情绪、有判断就带出来:"这需求有点怪""我觉得这样更顺""这个我拿不准"。别把自己写成没有温度的执行器。
- 这只是**说话的语气**;干活的专业、严谨、结果该怎样还怎样,不打折。`
  const systemPrompt = (recipe?.systemPrompt || adhocPrompt) + talkLikeHuman
  // Pi 内置工具名是小写:read/bash/edit/write/grep/find/ls。recipe.tools 存的是 Claude 大写名。
  // 映射:大写 → 小写;未知工具名原样透传(Pi 会忽略不存在的)。
  const toolNameMap: Record<string, string> = {
    Read: 'read', Write: 'write', Edit: 'edit', Bash: 'bash',
    Glob: 'find', Grep: 'grep', WebSearch: 'web', WebFetch: 'web',
  }
  const builtinTools = (recipe?.tools || ['Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])
    .map(t => toolNameMap[t] || t.toLowerCase())
  const recordedCwd = (recipe?.context?.cwd as string) || context?.cwd || ''
  const workDir = recordedCwd || getUserWorkspace(userId)
  const domain = context?.domain || ''

  let enrichedDescription = taskDescription

  if (context) {
    const peers = await getPeerAgents(userId, context.taskId, context.subtaskId)
    if (peers.length > 0) {
      const peerList = peers.map(p => `- ${p.name}: 正在做「${p.task}」`).join('\n')
      enrichedDescription += `\n\n## 协作 Agent\n你正在和以下 agent 并行工作：\n${peerList}`
    }
  }

  if (context?.signal?.aborted) throw new Error('任务已取消')

  const subtaskId = context?.subtaskId || `anon-${Date.now()}`
  const taskId = context?.taskId || 'unknown'

  // 历史注入(替代 SDK resume 黑盒)
  const reuseSubtaskId = context?.resumeSubtaskId
    ?? await findLastSubtaskForReuse(userId, recipeId, domain, taskDescription).catch(() => undefined)
  if (reuseSubtaskId && reuseSubtaskId !== subtaskId) {
    const history = await getSubtaskHistoryForPrompt(userId, reuseSubtaskId).catch(() => '')
    if (history) {
      enrichedDescription += `\n\n${history}`
      debug('history injected from subtask', reuseSubtaskId.slice(0, 8), `(${history.length} chars)`)
    }
  }

  debug('dispatch start:', recipeId, 'task:', taskDescription.slice(0, 50), reuseSubtaskId ? `(reuse: ${reuseSubtaskId.slice(0, 8)})` : '(new)')

  const userMcpTools = await buildUserMcpServers(userId)
  const agentCommsTools = createAgentCommsTools(subtaskId, taskId, userId, agentName)
  const customTools: ToolDefinition[] = [...userMcpTools, ...agentCommsTools]

  const disabledSkills = await getDisabledSkills(userId)
  const explicit = [...new Set([...(recipe?.skills || []), ...(context?.skills || [])])]
    .filter(name => !disabledSkills.has(name))
  const agentSkills = explicit.length ? explicit : await getEnabledHubSkills(userId)

  const MAX_RETRIES = 2
  const RETRY_DELAYS = [3000, 8000]

  let lastError = ''
  let result = ''
  let sessionId = ''

  await setSubtaskStarted(subtaskId, new Date().toISOString()).catch(() => {})
  let totalTurns = 0
  let tokensInput = 0
  let tokensOutput = 0
  let retriesUsed = 0
  let writtenFiles: string[] = []

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (context?.signal?.aborted) throw new Error('任务已取消')

    if (attempt > 0) {
      retriesUsed = attempt
      debug(`retry attempt ${attempt}/${MAX_RETRIES}, waiting ${RETRY_DELAYS[attempt - 1]}ms...`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]))
      if (context?.signal?.aborted) throw new Error('任务已取消')
      context?.onProgress?.({
        text: `⚠️ API 错误，第 ${attempt} 次重试中...`,
        turnCount: 0,
      })
    }

    result = ''
    sessionId = ''
    let turnCount = 0
    const progressLog: string[] = []
    let apiError = false
    writtenFiles = []
    let sawSuccessResult = false
    let postDoneRefeeds = 0
    const MAX_POST_DONE_REFEEDS = 3
    const pendingCalls = new Map<string, { toolName: string; args: unknown; callIndex: number; startedAt: string }>()
    let callIdxInTurn = 0

    // 注册到 bus — handler 处理 Jarvis/其他 agent 发来的消息
    bus.register(subtaskId, `${agentName}#${subtaskId.slice(0, 6)}`, async (msg) => {
      const text = msg.parts.find(p => p.kind === 'text')?.text || ''
      if (!text) return null
      const sent = await sendToAgent(subtaskId, text)
      if (!sent) return null
      debug('bus → agent injected:', text.slice(0, 40))
      return null
    })

    const modelRuntime = await getModelRuntime()
    const model = await getJarvisModel(recipe?.model || 'sonnet')
    if (!model) throw new Error('未找到可用的 LLM 模型(桥接 provider 与 Pi 默认均未配置)')
    const loader = new DefaultResourceLoader({
      cwd: workDir,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
    })
    await loader.reload()

    const { session } = await createAgentSession({
      cwd: workDir,
      model,
      modelRuntime,
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(workDir),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      // 只启用 recipe 指定的内置工具 + customTools(默认全部启用)
      // 注意:Pi 的 tools 是 allowlist,传了就只启用列出的;不传则默认 read/bash/edit/write + customTools
      // 小弟通常需要全套内置能力,这里不传 tools 让默认生效。
    })

    // 事件订阅:翻译 Pi 事件 → progress / tool trace
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent
        // 文本流式不直接累积(从 turn_end / agent_end 取完整结果),但可记 progress
        if (ae.type === 'text_delta' && ae.delta) {
          const snippet = ae.delta.slice(0, 60).replace(/\n/g, ' ')
          // 不每 token 推 progress(太频繁),只兜底记一条
        }
      }
      if (event.type === 'turn_start') {
        turnCount++
        totalTurns++
        callIdxInTurn = 0
      }
      if (event.type === 'tool_execution_start') {
        const toolName = event.toolName
        // 抓写文件动作
        const fp = (event.args as any)?.file_path || (event.args as any)?.path
        if (typeof fp === 'string' && ['write', 'edit'].includes(toolName)) {
          writtenFiles.push(fp)
        }
        progressLog.push(`[${turnCount}] 🔧 ${toolName}`)
        pendingCalls.set(event.toolCallId, {
          toolName,
          args: event.args,
          callIndex: callIdxInTurn++,
          startedAt: new Date().toISOString(),
        })
        if (context?.onProgress) {
          const recent = progressLog.slice(-5).join('\n')
          context.onProgress({
            text: `回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`,
            turnCount,
            currentTool: toolName,
            currentAction: toolName,
          })
        }
      }
      if (event.type === 'tool_execution_end') {
        const pending = pendingCalls.get(event.toolCallId)
        if (pending) {
          pendingCalls.delete(event.toolCallId)
          const resultContent = event.result?.content
          const resultText = flattenResultText(resultContent)
          recordToolTrace(userId, {
            scope: 'subtask',
            subtaskId,
            turnIndex: totalTurns,
            callIndex: pending.callIndex,
            toolCallId: event.toolCallId,
            toolName: pending.toolName,
            args: pending.args,
            result: resultContent,
            resultText,
            isError: event.isError,
            startedAt: pending.startedAt,
            endedAt: new Date().toISOString(),
          }).catch(() => {})
        }
      }
      if (event.type === 'turn_end') {
        // 每个 turn 的 assistant 文本落一条回合轨迹
        const turnText = (event.message as any)?.content
          ?.filter((b: any) => b.type === 'text')
          ?.map((b: any) => b.text)
          ?.join('') || '(无文本输出)'
        recordTurn(subtaskId, totalTurns, turnText, new Date().toISOString(), new Date().toISOString()).catch(() => {})
        // 累积 result(取所有 turn 文本拼接)
        if (turnText && turnText !== '(无文本输出)') result += turnText
      }
      if (event.type === 'agent_end') {
        // 从最后一条 assistant 消息提取最终 result(若 turn_end 没攒全)
        const messages = event.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i] as any
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            const texts = m.content
              .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
            if (texts.length > 0) {
              result = result || texts.join('')
              break
            }
          }
        }
        // usage 提取
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i] as any
          if (m.role === 'assistant') {
            if (m.usage) {
              tokensInput += m.usage.input || 0
              tokensOutput += m.usage.output || 0
            }
            break
          }
        }
        debug('agent_end, result length:', result.length)
      }
    })

    const activeAgent: ActiveAgent = { session, unsubscribe }
    activeAgents.set(subtaskId, activeAgent)

    try {
      // abort 支持
      let onAbort: (() => void) | undefined
      if (context?.signal) {
        if (context.signal.aborted) {
          await session.abort()
          throw new Error('任务已取消')
        }
        onAbort = () => session.abort().catch(() => {})
        context.signal.addEventListener('abort', onAbort)
      }

      await session.prompt(enrichedDescription)

      if (onAbort) context!.signal!.removeEventListener('abort', onAbort)

      // prompt 完成后,检查收件箱:有消息就再 prompt一轮(最多 MAX_POST_DONE_REFEEDS 次)
      while (sawSuccessResult ? postDoneRefeeds < MAX_POST_DONE_REFEEDS : true) {
        const late = bus.drainInbox(subtaskId)
        if (late.length === 0) break
        if (sawSuccessResult) postDoneRefeeds++
        for (const m of late) {
          const t = m.parts.find(p => p.kind === 'text')?.text || ''
          if (t) await session.prompt(t)
        }
      }
      if (sawSuccessResult && postDoneRefeeds >= MAX_POST_DONE_REFEEDS) {
        const late = bus.drainInbox(subtaskId)
        if (late.length > 0) debug(`post-done refeed cap hit, dropping ${late.length} late msgs`)
      }

      sawSuccessResult = true
      sessionId = session.sessionId || ''
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      debug('agent ERROR:', errMsg)
      lastError = errMsg
      if (isRetryableError(errMsg) && attempt < MAX_RETRIES) {
        apiError = true
      } else {
        if (!result) result = `[执行错误] ${errMsg}`
      }
    } finally {
      unsubscribe()
      activeAgents.delete(subtaskId)
      interruptedSubtasks.delete(subtaskId)
      bus.unregister(subtaskId)
      session.dispose()
    }

    if (!apiError) break
    debug('retryable error detected, will retry:', lastError)
  }

  // 写入执行元信息统计
  await finalizeSubtaskMeta(subtaskId, {
    turnCount: totalTurns,
    retryCount: retriesUsed,
    tokensInput,
    tokensOutput,
  }).catch(() => {})

  if (writtenFiles.length) writtenFilesMap.set(subtaskId, writtenFiles)

  const finalSessionId = sessionId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await recordAgentSession(userId, finalSessionId, recipeId, taskDescription, domain, recordedCwd)
  debug('recorded agent session:', finalSessionId, 'domain:', domain)

  if (!recipe && domain) {
    await upsertAdhocAgent(userId, {
      domain,
      taskDescription,
      cwd: recordedCwd || undefined,
      sessionId,
      topics: extractKeywords(taskDescription),
    }).catch(() => {})
  }

  return result || '(无结果)'
}
