import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getPeerAgents } from './registry.js'

const JARVIS_PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'jarvis', 'plugins', 'jarvis')
const SKILLS_HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'jarvis', 'plugins', 'skills-hub')
import { getRecipe } from '../team/registry.js'
import { recordAgentSession, findLastSubtaskForReuse, extractKeywords } from './history.js'
import { upsertAdhocAgent } from './adhoc.js'
import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta } from '../task/manager.js'
import { bus } from './bus.js'
import { buildUserEnv } from '../shared/user-env.js'
import { getUserWorkspace } from '../shared/user-workspace.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'
import { createAgentCommsMcp } from './agent-comms.js'
import { getSubtaskHistoryForPrompt } from './subtask-history-context.js'
import { getDisabledSkills, getEnabledHubSkills } from '../jarvis/skill-prefs.js'
import {
  recordToolTrace,
  flattenResultText,
  isToolUseBlock,
  extractToolResults,
  type PendingToolCall,
} from '../shared/tool-trace.js'

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')
function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[agent-debug]\x1b[0m', ...args)
}

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()

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

const activeQueries = new Map<string, Query>()

export function getActiveQuery(subtaskId: string): Query | undefined {
  return activeQueries.get(subtaskId)
}

// 小弟实际写过的文件路径(按写入顺序),供任务完成时确定性挑成品预览。
// 不依赖 LLM 主动调 render_preview——那会偷懒/幻觉。
const writtenFilesMap = new Map<string, string[]>()
export function takeWrittenFiles(subtaskId: string): string[] {
  const files = writtenFilesMap.get(subtaskId) || []
  writtenFilesMap.delete(subtaskId)
  return files
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
  const recipe = await getRecipe(userId, recipeId)

  const adhocPrompt = `你是一个专项任务执行者，负责完成分配给你的任务。认真执行，返回详细结果。

## 沟通能力

你有以下沟通工具（agent-comms MCP）:
- message_jarvis: 给管家 Jarvis 发消息(type: question | progress | deliverable | blocked)
- message_peer: 给并行协作的其他 Agent 发消息(异步、非阻塞,消息进对方收件箱)
- check_inbox: 查看自己的收件箱(Jarvis 的追加指令、其他 Agent 的消息/回复)。建议每几轮工作后主动查一次
- list_peers: 查看和你并行工作的其他 Agent

何时沟通、是否沟通,由你自主判断。判断原则:信息不足时问,有风险时确认,能独立完成时直接交付。
message_peer 发出去后你不用等,继续干活即可;等对方回复到了,在下一轮工作前 check_inbox 看到就行。`

  const agentName = recipe?.name || recipeId
  const systemPrompt = recipe?.systemPrompt || adhocPrompt
  const tools = recipe?.tools || ['Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
  // 门牌号：小弟 recipe 自带 cwd > 本次任务指定 cwd（开发类）。纯调研类无门牌号。
  const recordedCwd = (recipe?.context?.cwd as string) || context?.cwd || ''
  // 执行工作目录：有门牌号（开发类）就用；否则（调研/生活类）落到用户专属沙盒，
  // 避免临时产物污染项目目录或进程 cwd。兜底值不写进 history（recordedCwd 保持为空）。
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

  // 历史注入(替代 SDK resume 黑盒):找一个可复用的历史 subtask,把它的完整执行记忆
  // (任务描述+思考+工具轨迹+Jarvis 沟通)拼进 prompt。显式指定优先,否则按 assignee 自动匹配。
  // 全程 .catch 降级 —— 拉不到历史绝不阻塞派单。
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

  const userMcpServers = await buildUserMcpServers(userId)
  const agentCommsMcp = createAgentCommsMcp(subtaskId, taskId, userId, agentName)
  // 把 MCP servers 的工具通配符加进 allowedTools（bypassPermissions 模式下这是白名单）。
  // 除了显式枚举每个 MCP,还统一追加 'mcp__*' 通配 —— 兼容内置 recipe / adhoc / 晋升 recipe 的 tools
  // 白名单里没写 mcp__* 的情况(方案 1:改调用处,不迁移 DB 数据)。
  const mcpToolNames = Object.keys(userMcpServers).map(name => `mcp__${name}__*`)
  const allowedTools = [...tools, ...mcpToolNames, 'mcp__agent-comms__*', 'mcp__*']

  const disabledSkills = await getDisabledSkills(userId)
  const explicit = [...new Set([...(recipe?.skills || []), ...(context?.skills || [])])]
    .filter(name => !disabledSkills.has(name))
  // Jarvis 显式挂了 skill 就用它(已过滤禁用);没挂则退回"全部启用的 hub skill"——
  // 与 SDK 省略时的默认(全部)语义一致,但去掉了用户禁用的。恒传显式数组,
  // 因为 SDK 里 skills 省略 ≠ 关闭(sdk.d.ts:1841)。
  const agentSkills = explicit.length ? explicit : await getEnabledHubSkills(userId)

  const queryOptions: Record<string, any> = {
    systemPrompt,
    pathToClaudeCodeExecutable: CLAUDE_PATH,
    allowedTools,
    cwd: workDir,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    plugins: [{ type: 'local', path: JARVIS_PLUGIN_DIR }, { type: 'local', path: SKILLS_HUB_DIR }],
    skills: agentSkills,
    env: await buildUserEnv(userId),
    maxTurns: 99999,
    mcpServers: { ...userMcpServers, 'agent-comms': agentCommsMcp },
  }

  const MAX_RETRIES = 2
  const RETRY_DELAYS = [3000, 8000]

  let lastError = ''
  let result = ''
  let sessionId = ''

  // 开工时刻(排队等待不计入执行耗时)——只在首次真正开跑时记一次
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
    // 工具调用采集:tool_use 时暂存,tool_result 到达时配对入库
    const pendingCalls = new Map<string, PendingToolCall>()

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
          const turnStart = new Date().toISOString()
          turnCount++
          totalTurns++
          let turnText = ''
          let callIdxInTurn = 0  // 同一回合内 tool_use 的顺序

          for (const block of message.message.content) {
            if ('text' in block && block.text) {
              result += block.text
              turnText += block.text
              const snippet = block.text.slice(0, 60).replace(/\n/g, ' ')
              progressLog.push(`[${turnCount}] ${snippet}`)
            }
            if (isToolUseBlock(block)) {
              const toolName = block.name
              // 抓写文件动作,供任务完成时确定性挑成品预览
              const fp = (block.input as any)?.file_path
              if (typeof fp === 'string' && ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
                writtenFiles.push(fp)
              }
              turnText += `\n🔧 ${toolName}`
              progressLog.push(`[${turnCount}] 🔧 ${toolName}`)
              // 暂存,等 tool_result 到达时配对
              pendingCalls.set(block.id, {
                toolCallId: block.id,
                toolName,
                args: block.input,
                callIndex: callIdxInTurn++,
                startedAt: turnStart,
              })
            }
          }

          // 落一条回合轨迹(text 空则记占位,避免 NOT NULL 违规)
          recordTurn(subtaskId, totalTurns, turnText || '(无文本输出)', turnStart, new Date().toISOString()).catch(() => {})

          if (context?.onProgress) {
            const recent = progressLog.slice(-5).join('\n')
            const text = `回合 ${turnCount} | 已执行 ${progressLog.length} 步\n${recent}`
            // 从最新 progressLog 里抓最后一条工具/文本作 currentAction/currentTool
            const lastLog = progressLog[progressLog.length - 1] || ''
            const toolMatch = lastLog.match(/🔧 (\S+)/)
            context.onProgress({
              text,
              turnCount,
              currentTool: toolMatch ? toolMatch[1] : undefined,
              currentAction: lastLog.replace(/^\[\d+\] /, '').slice(0, 80),
            })
          }
        }

        // SDK 用 type='user' 消息把 tool_result 送回来(下一轮 LLM 调用的输入)。
        // 每个 tool_result block 通过 tool_use_id 配对之前 pending 的 tool_use。
        if (message.type === 'user' && (message as any).message?.content) {
          const endedAt = new Date().toISOString()
          const results = extractToolResults(message)
          for (const tr of results) {
            const pending = pendingCalls.get(tr.toolUseId)
            if (!pending) continue  // 找不到配对(不太可能,但兜底)
            pendingCalls.delete(tr.toolUseId)
            const resultText = flattenResultText(tr.content)
            recordToolTrace(userId, {
              scope: 'subtask',
              subtaskId,
              turnIndex: totalTurns,
              callIndex: pending.callIndex,
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              args: pending.args,
              result: tr.content,
              resultText,
              isError: tr.isError,
              startedAt: pending.startedAt,
              endedAt,
            })
          }
        }

        if (message.type === 'result') {
          sessionId = (message as any).session_id || (message as any).sessionId || ''
          const usage = (message as any).usage
          if (usage) {
            tokensInput += usage.input_tokens || 0
            tokensOutput += usage.output_tokens || 0
          }
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

  // 写入执行元信息统计
  await finalizeSubtaskMeta(subtaskId, {
    turnCount: totalTurns,
    retryCount: retriesUsed,
    tokensInput,
    tokensOutput,
  }).catch(() => {})

  // 记下小弟写过的文件,供任务完成时确定性挑成品预览
  if (writtenFiles.length) writtenFilesMap.set(subtaskId, writtenFiles)

  const finalSessionId = sessionId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // 聚类主键是 domain（语义领域），cwd 仅作开发类任务的门牌号辅料（纯调研为空）
  await recordAgentSession(userId, finalSessionId, recipeId, taskDescription, domain, recordedCwd)
  debug('recorded agent session:', finalSessionId, 'domain:', domain)

  // 临时工(无 recipe)才聚合到 adhoc 表;正式小弟不写
  if (!recipe && domain) {
    await upsertAdhocAgent(userId, {
      domain,
      taskDescription,
      cwd: recordedCwd || undefined,
      sessionId,  // 原始 sessionId(可能空),adhoc.ts 内部过滤 auto-;此处不传 finalSessionId
      topics: extractKeywords(taskDescription),
    }).catch(() => {})
  }

  return result || '(无结果)'
}
