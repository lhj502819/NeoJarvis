import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { getModelRuntime, getJarvisModel } from '../shared/pi-models.js'
import { buildSystemPrompt } from './prompt.js'
import type { ChatImage } from '../shared/types.js'
import { createJarvisTools } from './tools.js'
import { broadcast } from './sse.js'
import { buildUserEnv } from '../shared/user-env.js'
import { getUserWorkspace } from '../shared/user-workspace.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'
import { getEnabledHubSkills, PIPELINE_SKILLS } from './skill-prefs.js'
import {
  flattenResultText,
  type ToolTraceInput,
} from '../shared/tool-trace.js'

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')

export function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[debug]\x1b[0m', ...args)
}

const brainLocks = new Map<string, Promise<void>>()

export function withBrainLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = brainLocks.get(userId) || Promise.resolve()
  let resolve: () => void
  brainLocks.set(userId, new Promise(r => { resolve = r }))
  return prev.then(fn).finally(() => resolve!())
}

/**
 * ModelRuntime 由 shared/pi-models.ts 统一装配(用户 claude CLI 代理桥接 → Pi 自定义
 * provider;无桥接配置时用 Pi 默认直连)。
 */

export async function llmCall(
  userId: string,
  prompt: string,
  onDelta?: (text: string) => void,
  abortController?: AbortController,
  images?: ChatImage[],
  toolTraces?: Array<Omit<ToolTraceInput, 'scope' | 'messageId'>>,
): Promise<string> {
  const systemPrompt = await buildSystemPrompt(userId)
  const jarvisTools = createJarvisTools(userId)
  const userMcpTools = await buildUserMcpServers(userId)
  const customTools: ToolDefinition[] = [...jarvisTools, ...userMcpTools]
  return rawLlmCall(userId, systemPrompt, prompt, onDelta, customTools, abortController, images, toolTraces)
}

/**
 * Jarvis 本体调用 LLM。返回值:纯文本 result。
 *
 * 迁移自 Claude Agent SDK 的 query()。Pi 用 createAgentSession() + session.prompt():
 *   - session 单次创建,prompt 可多次调用(这里每次 rawLlmCall 建一个临时 session,
 *     因为 systemPrompt/tools 随 userId 变;长期可复用 session + setModel 替换)
 *   - 流式输出通过 session.subscribe() 监听 message_update.text_delta
 *   - 工具调用通过 tool_execution_start/end 事件采集(替代旧的 tool_use/tool_result 配对)
 *   - 图片走 prompt options.images
 */
export async function rawLlmCall(
  userId: string,
  systemPrompt: string,
  prompt: string,
  onDelta?: (text: string) => void,
  customTools?: ToolDefinition[],
  abortController?: AbortController,
  images?: ChatImage[],
  toolTraces?: Array<Omit<ToolTraceInput, 'scope' | 'messageId'>>,
): Promise<string> {
  const t0 = Date.now()
  debug('rawLlmCall start, prompt length:', prompt.length, images?.length ? `+${images.length} images` : '')
  console.log(`[perf] rawLlmCall start, system prompt: ${systemPrompt.length} chars, user prompt: ${prompt.length} chars`)

  const modelRuntime = await getModelRuntime()
  const model = await getJarvisModel('sonnet')
  if (!model) {
    throw new Error('未找到可用的 LLM 模型(桥接 provider 与 Pi 默认均未配置)。请检查 ~/.claude/settings.json 或 ~/.pi/agent/auth.json')
  }
  const cwd = getUserWorkspace(userId)

  // 用 DefaultResourceLoader 注入 systemPrompt + skills,关闭 extensions 发现(避免加载
  // 全局 ~/.pi/agent/extensions 干扰)。customTools 直接传 createAgentSession。
  const enabledSkills = [...PIPELINE_SKILLS, ...(await getEnabledHubSkills(userId))]
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    systemPromptOverride: () => systemPrompt,
    // 把启用 skills 注入 loader(供 prompt 拼接)。注意 Pi 的 skill 发现走文件系统,
    // 这里用 skillsOverride 合并用户启用的 hub skills。
  })
  await loader.reload()

  // 构造图片 content(若有)
  const imageContents = images && images.length > 0
    ? images.map(img => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType as any, data: img.data },
      }))
    : undefined

  let finalResult = ''
  let firstTokenTime = 0
  // 工具调用采集:tool_execution_start 时暂存,tool_execution_end 时配对入库
  const pendingCalls = new Map<string, { toolName: string; args: unknown; callIndex: number; startedAt: string }>()
  let callIdxGlobal = 0

  const { session } = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    customTools,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    // 不限制 tools allowlist —— customTools 默认全部启用;内置工具(read/bash/edit/write)也保留,
    // 因为 Jarvis 本体需要能读写文件(如制品、配置)。如需禁用内置工具用 noTools: 'builtin'。
  })

  // 事件订阅:把 Pi 的 AgentSessionEvent 翻译成旧的 onDelta / broadcast / toolTraces
  const unsub = session.subscribe((event) => {
    switch (event.type) {
      case 'message_update': {
        const ae = event.assistantMessageEvent
        if (ae.type === 'thinking_delta') {
          if (!firstTokenTime) {
            firstTokenTime = Date.now()
            console.log(`[perf] first thinking token: ${firstTokenTime - t0}ms`)
          }
        }
        if (ae.type === 'text_delta' && ae.delta) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now()
            console.log(`[perf] first token: ${firstTokenTime - t0}ms`)
          }
          onDelta?.(ae.delta)
        }
        break
      }
      case 'tool_execution_start': {
        const toolName = event.toolName
        const toolCallId = event.toolCallId
        debug('tool_use:', toolName)
        broadcast('progress', `🔧 Jarvis 正在使用 ${toolName}...`, userId)
        if (toolTraces) {
          pendingCalls.set(toolCallId, {
            toolName,
            args: event.args,
            callIndex: callIdxGlobal++,
            startedAt: new Date().toISOString(),
          })
        }
        break
      }
      case 'tool_execution_end': {
        if (toolTraces) {
          const pending = pendingCalls.get(event.toolCallId)
          if (pending) {
            pendingCalls.delete(event.toolCallId)
            const resultContent = event.result?.content
            const resultText = flattenResultText(resultContent)
            toolTraces.push({
              subtaskId: null,
              turnIndex: null,
              callIndex: pending.callIndex,
              toolCallId: event.toolCallId,
              toolName: pending.toolName,
              args: pending.args,
              result: resultContent,
              resultText,
              isError: event.isError,
              startedAt: pending.startedAt,
              endedAt: new Date().toISOString(),
            })
          }
        }
        break
      }
      case 'agent_end': {
        // 从最后一条 assistant 消息提取纯文本 result
        const messages = event.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i] as any
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            const texts = m.content
              .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
            if (texts.length > 0) {
              finalResult = texts.join('')
              break
            }
          }
        }
        debug('agent_end, result length:', finalResult.length)
        break
      }
    }
  })

  try {
    // abort 支持:把外部 abortController 接到 session.abort()
    const ac = abortController
    let onAbort: (() => void) | undefined
    if (ac) {
      if (ac.signal.aborted) {
        await session.abort()
      } else {
        onAbort = () => session.abort().catch(() => {})
        ac.signal.addEventListener('abort', onAbort)
      }
    }

    try {
      await session.prompt(prompt, imageContents ? { images: imageContents as any } : undefined)
    } finally {
      if (onAbort && ac) ac.signal.removeEventListener('abort', onAbort)
    }
  } finally {
    unsub()
    session.dispose()
  }

  debug('rawLlmCall done, result length:', finalResult.length)
  console.log(`[perf] rawLlmCall done: ${Date.now() - t0}ms total, result: ${finalResult.length} chars`)
  return finalResult
}
