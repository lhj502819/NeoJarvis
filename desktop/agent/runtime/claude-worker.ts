import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { piToolDefToRuntime, type RuntimeTool } from '../shared/agent-runtime.js'
import { getClaudeExecutable, jsonSchemaToZodShape } from './claude.js'
import { recordToolTrace } from '../shared/tool-trace.js'
import { recordTurn } from '../task/manager.js'
import { bus } from '../a2a/bus.js'

/**
 * Claude Agent SDK 小弟运行时(P6 Phase B):
 * 与 Pi 路径(dispatchToAgent 内联)同一契约:
 *   - 进度回调(onProgress:回合/工具)/ 工具轨迹(recordToolTrace scope=subtask)
 *   - 回合记录(recordTurn)/ 写文件捕获 / 结果累积
 *   - bus 跟进消息:不中断在跑 query,进收件箱,回合结束后 resume 续跑(逐条)
 *   - 重试(MAX_RETRIES=2)/ abort
 * 与 Pi 的差异:跟进消息在回合间投递(Pi 是回合内注入);skill 经 workDir/.claude/skills 软链加载。
 */

export interface ClaudeWorkerParams {
  userId: string
  subtaskId: string
  taskId: string
  agentName: string
  recipeId: string
  domain: string
  enrichedDescription: string
  systemPrompt: string
  agentSkillDir: string | null
  workDir: string
  customTools: ToolDefinition[]
  context?: {
    signal?: AbortSignal
    onProgress?(p: { text: string; turnCount: number; currentTool?: string; currentAction?: string }): void
  }
  recordedCwd?: string
}

export interface ClaudeWorkerResult {
  result: string
  sessionId: string
  totalTurns: number
  retriesUsed: number
  tokensInput: number
  tokensOutput: number
  writtenFiles: string[]
}

const MAX_RETRIES = 2
const RETRY_DELAYS = [3000, 8000]
const MAX_TURNS_PER_QUERY = 40
const MAX_INBOX_REFEEDS = 10

function isRetryableError(msg: string): boolean {
  return /timeout|ECONNRESET|ETIMEDOUT|529|overloaded|rate.?limit|503|504/i.test(msg)
}

function linkSkills(agentSkillDir: string | null, workDir: string): void {
  if (!agentSkillDir || !existsSync(agentSkillDir)) return
  try {
    const target = join(workDir, '.claude', 'skills', 'dev-avatar')
    if (!existsSync(target)) {
      mkdirSync(join(workDir, '.claude', 'skills'), { recursive: true })
      symlinkSync(agentSkillDir, target)
    }
  } catch { /* 软链失败不致命,系统提示词里已带约束 */ }
}

export async function runClaudeWorker(params: ClaudeWorkerParams): Promise<ClaudeWorkerResult> {
  const { userId, subtaskId, taskId, agentName, enrichedDescription, systemPrompt, agentSkillDir, workDir, customTools, context } = params

  // 工具:agent-comms/read_context 等 Pi 定义 → RuntimeTool → SDK MCP server
  const runtimeTools: RuntimeTool[] = customTools.map(d => piToolDefToRuntime(d as any))
  const zodShapes: Record<string, any> = {}
  const handlers: Record<string, any> = {}
  for (const rt of runtimeTools) {
    zodShapes[rt.name] = jsonSchemaToZodShape(rt.jsonSchema)
    handlers[rt.name] = async (args: Record<string, unknown>) => {
      try {
        const r = await rt.execute(args ?? {})
        return { content: [{ type: 'text' as const, text: r.text || '(空结果)' }], isError: !!r.isError }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `工具执行失败:${err instanceof Error ? err.message : String(err)}` }], isError: true }
      }
    }
  }
  const sdkServer = runtimeTools.length > 0
    ? createSdkMcpServer({
        name: `worker-${subtaskId.slice(0, 8)}`,
        version: '1.0.0',
        tools: runtimeTools.map(rt => tool(rt.name, rt.description, zodShapes[rt.name] ?? {}, handlers[rt.name])),
      })
    : undefined

  // SDK spawn 对不存在的 cwd 报误导性的 "failed to launch" —— 先确保 workDir 存在
  mkdirSync(workDir, { recursive: true })
  linkSkills(agentSkillDir, workDir)

  const inbox: string[] = []
  bus.register(subtaskId, `${agentName}#${subtaskId.slice(0, 6)}`, async (msg) => {
    const text = msg.parts.find(p => p.kind === 'text')?.text || ''
    if (text) {
      inbox.push(text)
      console.log(`[worker:claude] 收进收件箱(${inbox.length}): ${text.slice(0, 40)}`)
    }
    return null
  })

  const writtenFiles: string[] = []
  let totalTurns = 0
  let tokensInput = 0
  let tokensOutput = 0
  let result = ''
  let sessionId = ''
  let lastError = ''
  let retriesUsed = 0
  const model = process.env.JARVIS_LLM_MODEL || 'sonnet'

  const buildOptions = (resumeId?: string, signal?: AbortSignal) => {
    const ac = new AbortController()
    if (signal?.aborted) ac.abort()
    else signal?.addEventListener('abort', () => ac.abort(), { once: true })
    return {
      systemPrompt,
      settingSources: [] as any[],
      model,
      cwd: workDir,
      ...(sdkServer ? { mcpServers: { 'worker-tools': sdkServer } } : {}),
      maxTurns: MAX_TURNS_PER_QUERY,
      permissionMode: 'bypassPermissions' as const,
      includePartialMessages: false,
      ...(resumeId ? { resume: resumeId } : {}),
      abortController: ac,
      ...(getClaudeExecutable() ? { pathToClaudeCodeExecutable: getClaudeExecutable() } : {}),
    }
  }

  /** 跑一次 query:返回本轮 assistant 文本累积;副作用:轨迹/回合记录/进度/usage。 */
  async function runQuery(prompt: string, resumeId?: string, signal?: AbortSignal): Promise<string> {
    let turnResult = ''
    const openCalls = new Map<string, { name: string; args: unknown; startedAt: string }>()

    for await (const message of query({ prompt, options: buildOptions(resumeId, signal) }) as AsyncIterable<any>) {
      if (message.session_id && !sessionId) sessionId = message.session_id

      if (message.type === 'assistant') {
        const content = message.message?.content ?? []
        for (const block of content) {
          if (block.type === 'tool_use') {
            openCalls.set(block.id, { name: block.name, args: block.input, startedAt: new Date().toISOString() })
            if (['Write', 'Edit', 'write', 'edit'].includes(block.name)) {
              const fp = (block.input as any)?.file_path || (block.input as any)?.path
              if (typeof fp === 'string') writtenFiles.push(fp)
            }
            context?.onProgress?.({
              text: `回合 ${totalTurns + 1} | 🔧 ${block.name}`,
              turnCount: totalTurns + 1,
              currentTool: block.name,
              currentAction: block.name,
            })
          }
          if (block.type === 'text' && block.text) {
            totalTurns++
            recordTurn(subtaskId, totalTurns, block.text, new Date().toISOString(), new Date().toISOString()).catch(() => {})
            turnResult += block.text
          }
        }
        continue
      }
      if (message.type === 'user') {
        for (const block of message.message?.content ?? []) {
          if (block.type === 'tool_result') {
            const open = openCalls.get(block.tool_use_id)
            if (open) {
              openCalls.delete(block.tool_use_id)
              const resultContent = block.content
              const resultText = typeof resultContent === 'string' ? resultContent
                : Array.isArray(resultContent)
                  ? resultContent.map((c: any) => c?.text ?? `[${c?.type}]`).join('\n')
                  : ''
              recordToolTrace(userId, {
                scope: 'subtask',
                subtaskId,
                turnIndex: totalTurns,
                callIndex: 0,
                toolCallId: block.tool_use_id,
                toolName: open.name,
                args: open.args,
                result: resultContent,
                resultText,
                isError: !!block.is_error,
                startedAt: open.startedAt,
                endedAt: new Date().toISOString(),
              }).catch(() => {})
            }
          }
        }
        continue
      }
      if (message.type === 'result') {
        if (typeof message.usage?.input_tokens === 'number') tokensInput += message.usage.input_tokens
        if (typeof message.usage?.output_tokens === 'number') tokensOutput += message.usage.output_tokens
        if (message.is_error) throw new Error(String(message.result ?? 'claude worker 出错'))
        if (message.result && !turnResult) turnResult = String(message.result)
        continue
      }
    }
    return turnResult
  }

  // ── 主循环:首轮 + 收件箱续跑(retry 包在外层) ──
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (context?.signal?.aborted) throw new Error('任务已取消')
    if (attempt > 0) {
      retriesUsed = attempt
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]))
      context?.onProgress?.({ text: `⚠️ API 错误,第 ${attempt} 次重试中...`, turnCount: 0 })
    }
    try {
      result = await runQuery(enrichedDescription)
      // 回合间收件箱续跑:有跟进就 resume 继续跑(上限防死循环)
      let refeeds = 0
      for (;;) {
        const late = inbox.splice(0, inbox.length)
        if (late.length === 0) break
        if (refeeds >= MAX_INBOX_REFEEDS) { console.warn(`[worker:claude] 收件箱续跑上限,丢弃 ${late.length} 条`); break }
        refeeds++
        for (const t of late) {
          result += `\n${await runQuery(t, sessionId, context?.signal)}`
        }
      }
      if (result) break
      lastError = '无输出'
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      lastError = errMsg
      if (isRetryableError(errMsg) && attempt < MAX_RETRIES) continue
      result = result || `[执行错误] ${errMsg}`
      break
    }
  }

  bus.unregister(subtaskId)
  void taskId
  return { result: result || '(无结果)', sessionId, totalTurns, retriesUsed, tokensInput, tokensOutput, writtenFiles }
}
