import { serverPost } from './server-client.js'

/**
 * 一次工具调用的完整信息(参考 Letta:tool_call/tool_result 作为一等公民)。
 * 由 TS 采集点(desktop/agent/jarvis/llm.ts、desktop/agent/a2a/client.ts)在 SDK
 * for await 循环里拼装:遇到 assistant 消息里的 tool_use block 记 args + started_at,
 * 遇到 user 消息里的 tool_result block(或 SDKUserMessage.tool_use_result)配对 result + ended_at。
 *
 * 大 tool 返回策略:TS 端 stringify + 保留原始;Java ToolTraceService 侧做 50K 硬截断。
 */
export interface ToolTraceInput {
  scope: 'jarvis' | 'subtask'
  /** scope='jarvis' 时必填:归属哪条 user_jarvis_messages(自增主键)。 */
  messageId?: number | null
  /** scope='subtask' 时必填。 */
  subtaskId?: string | null
  /** scope='subtask' 时的回合号(与 jarvis_subtask_turns.turn_index 对齐)。 */
  turnIndex?: number | null
  /** 同一 assistant 消息内的工具调用顺序(0..N)。 */
  callIndex: number
  /** Anthropic 的 toolu_xxx,配对 tool_use 和 tool_result。 */
  toolCallId: string
  toolName: string
  /** 完整 input JSON(可能含大 payload)。 */
  args: unknown
  /** 完整 tool_result content(可能 null:未返回;可能是 string 或 blocks[])。 */
  result?: unknown
  /** 从 result 摊平的纯文本(50K 截断作用在这里)。 */
  resultText?: string | null
  isError?: boolean
  startedAt: string
  endedAt?: string | null
}

/**
 * PG 不允许 `\x00` 存到 text/jsonb 里,采集时统一先剥掉。
 * 大 payload 也保留原样(50K 截断由 Java 侧统一做,不信客户端)。
 */
function sanitize(s: string): string {
  return s.replace(/\x00/g, '')
}

function safeStringify(v: unknown): string {
  if (v === undefined) return 'null'
  try {
    return sanitize(JSON.stringify(v))
  } catch {
    return JSON.stringify({ __unserializable: String(v).slice(0, 500) })
  }
}

/**
 * 从 tool_result block 或 SDKUserMessage.tool_use_result 摊平出纯文本快照。
 * result 可能是:
 *   - string(SDK 早期或简单工具)
 *   - Array<{type:'text', text}> / Array<{type:'image', ...}>(Anthropic 标准)
 *   - Record(SDKUserMessage.tool_use_result 时的原始 unknown)
 */
export function flattenResultText(result: unknown): string | null {
  if (result == null) return null
  if (typeof result === 'string') return sanitize(result)
  if (Array.isArray(result)) {
    const parts: string[] = []
    for (const b of result) {
      if (b && typeof b === 'object') {
        const obj = b as any
        if (typeof obj.text === 'string') parts.push(obj.text)
        else if (obj.type === 'image') parts.push('[image]')
        else parts.push(JSON.stringify(obj))
      }
    }
    return sanitize(parts.join('\n'))
  }
  // object / number / boolean 兜底 JSON stringify
  try { return sanitize(JSON.stringify(result)) } catch { return null }
}

/**
 * POST /api/tool-traces。失败不 throw(工具调用记录不该影响主流程),只 log。
 * userId 由 shared/server-client 通过 X-Internal-User 头透传。
 */
export async function recordToolTrace(userId: string, input: ToolTraceInput): Promise<void> {
  try {
    await serverPost(userId, '/api/tool-traces', {
      scope: input.scope,
      messageId: input.messageId ?? null,
      subtaskId: input.subtaskId ?? null,
      turnIndex: input.turnIndex ?? null,
      callIndex: input.callIndex,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: safeStringify(input.args),
      result: input.result === undefined ? null : safeStringify(input.result),
      resultText: input.resultText ? sanitize(input.resultText) : null,
      isError: !!input.isError,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
    })
  } catch (err) {
    // 落库失败不阻塞采集主链路(主链路 = SDK 消息流)。
    console.warn('[tool-trace] record failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * 采集点的"pending 队列":遇到 tool_use 时暂存 {id, name, args, startedAt},
 * 稍后遇到 tool_result(下一条 user 消息)按 tool_use_id 配对。
 */
export interface PendingToolCall {
  toolCallId: string
  toolName: string
  args: unknown
  callIndex: number
  startedAt: string
}

/** 从 assistant.content block 中提取 tool_use(SDK block.type === 'tool_use')。 */
export function isToolUseBlock(block: unknown): block is { id: string; name: string; input: unknown; type: 'tool_use' } {
  if (!block || typeof block !== 'object') return false
  const b = block as any
  return b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string'
}

/**
 * 从 SDK 的 user 消息里提取所有 tool_result blocks(Anthropic API 标准形状)。
 * SDK 里 user 消息的 content 可以是 string 或 blocks[]。
 */
export interface ToolResultBlock {
  toolUseId: string
  content: unknown
  isError: boolean
}
export function extractToolResults(userMessage: any): ToolResultBlock[] {
  const out: ToolResultBlock[] = []
  const content = userMessage?.message?.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && (b as any).type === 'tool_result') {
        const bb = b as any
        if (typeof bb.tool_use_id === 'string') {
          out.push({
            toolUseId: bb.tool_use_id,
            content: bb.content,
            isError: !!bb.is_error,
          })
        }
      }
    }
  }
  return out
}
