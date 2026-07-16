import { serverGet } from '../shared/server-client.js'
import { redactSecrets } from '../shared/redact.js'

/**
 * Jarvis 本体的"上一轮工具调用轨迹"注入。
 *
 * 背景:Jarvis 每次 think() 都是新 session,SDK 不带历史。我们之前把 tool_use/tool_result
 * 落到了 jarvis_tool_traces 表(scope='jarvis',挂 message_id),但没接进 prompt ——
 * 导致 Jarvis 下一轮看不到自己上一步调过什么工具、返回了什么(比如 create_task 拿到的 task_id)。
 *
 * 这里做的事:从 /api/conversation 拿最近 N 条 jarvis 消息,对每条调
 * /api/message/{id}/tool-traces 拿工具调用,拼成结构化文字段落注入 contextualPrompt。
 * 5K/2K 截断在此层做(库里 50K 全量保留供审计/前端)。
 */

/** 后端 GET /api/conversation 返回的消息(加了 id 字段)。 */
interface ConversationMsg {
  id: number
  role: string
  content: string
  timestamp: number
}

/** 后端 GET /api/message/{id}/tool-traces 返回的单条 trace(字段对齐 ToolTraceRow)。 */
export interface ToolTraceRowDTO {
  id: string
  toolCallId: string
  toolName: string
  args: string         // JSON 字符串
  result: string | null
  resultText: string | null
  isError: boolean
  bytesOriginal: number | null
  truncated: boolean
  startedAt: string
  endedAt: string | null
}

/** 一条 jarvis 消息 + 它挂的工具调用。 */
export interface MessageTraces {
  messageId: number
  timestamp: number
  content: string
  traces: ToolTraceRowDTO[]
}

/** 上下文层截断阈值(字符数)。 */
const RESULT_TEXT_CONTEXT_LIMIT = 5_000
const ARGS_CONTEXT_LIMIT = 2_000
/** 整段注入的硬上限,超过则丢弃最老的 messageTraces。 */
const SECTION_TOTAL_LIMIT = 30_000

/**
 * 拉最近 N 条 role='jarvis' 消息的工具调用轨迹。
 * 失败时返回空数组(不阻塞 think)。
 */
export async function getRecentJarvisToolTraces(
  userId: string,
  limitMessages = 10,
): Promise<MessageTraces[]> {
  try {
    const messages = await serverGet<ConversationMsg[]>(userId, '/api/conversation')
    // 倒序(最新在前)过滤 jarvis 消息,取前 limitMessages 条
    const jarvisMsgs = messages
      .filter(m => m.role === 'jarvis')
      .slice(-limitMessages)   // 最新的在末尾,slice 取尾
      .reverse()                // 最新在前

    const out: MessageTraces[] = []
    for (const m of jarvisMsgs) {
      try {
        const traces = await serverGet<ToolTraceRowDTO[]>(
          userId,
          `/api/message/${m.id}/tool-traces`,
        )
        if (traces && traces.length > 0) {
          out.push({
            messageId: m.id,
            timestamp: m.timestamp,
            content: m.content,
            traces,
          })
        }
      } catch {
        // 单条 message 的 traces 拉失败,跳过,继续下一条
      }
    }
    return out
  } catch {
    return []
  }
}

/** 截断到 limit 字符,超阈值追加省略提示。 */
function truncate(text: string | null, limit: number, hint: string): string | null {
  if (!text) return null
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n[...省略,${hint}]`
}

/** 美化 args JSON(已经是字符串),失败兜底原样。 */
function prettyArgs(argsJson: string): string {
  try {
    const obj = JSON.parse(argsJson)
    return JSON.stringify(obj, null, 0)  // 紧凑单行,省 token
  } catch {
    return argsJson
  }
}

/** 把一组 trace 拼成一段文字(时间倒序,最新在前)。 */
function formatTracesBlock(items: MessageTraces[]): string {
  const lines: string[] = []
  for (const item of items) {
    const ago = formatRelative(item.timestamp)
    const contentPreview = item.content.slice(0, 60).replace(/\n/g, ' ')
    lines.push(`[${ago}] 你回复 Sir:"${contentPreview}${item.content.length > 60 ? '...' : ''}"`)
    for (const t of item.traces) {
      const args = truncate(prettyArgs(t.args), ARGS_CONTEXT_LIMIT, `args 超 ${ARGS_CONTEXT_LIMIT} 字符`)
      const result = truncate(t.resultText, RESULT_TEXT_CONTEXT_LIMIT, `result 超 ${RESULT_TEXT_LIMIT_HUMAN}`)
      lines.push(`  🔧 ${t.toolName}`)
      if (args) lines.push(`     args: ${redactSecrets(args)}`)
      if (result) {
        lines.push(`     → ${redactSecrets(result)}${t.truncated ? ' [库里已截断]' : ''}${t.isError ? ' [错误]' : ''}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

const RESULT_TEXT_LIMIT_HUMAN = '5K'

/** 相对时间(几秒前 / 几分钟前 / 几小时前)。 */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/**
 * 把工具调用轨迹拼成 prompt 段落。整体超 SECTION_TOTAL_LIMIT 时从最老的开始丢。
 * 输入空数组 → 返回空字符串(调用方据此决定是否插入 ## 段落头)。
 */
export function formatToolTracesForPrompt(items: MessageTraces[]): string {
  if (items.length === 0) return ''

  // 从最新往最老拼,超总长就停(老的丢掉)
  const kept: MessageTraces[] = []
  let totalLen = 0
  for (const item of items) {
    // 估算这条 block 长度:content + 每 trace 的 args/result 摘要
    const estLen = item.content.length
      + item.traces.reduce((s, t) => s + t.args.length + (t.resultText?.length ?? 0) + 100, 0)
    if (totalLen + estLen > SECTION_TOTAL_LIMIT) break
    kept.push(item)
    totalLen += estLen
  }

  if (kept.length === 0) return ''
  const block = formatTracesBlock(kept)
  if (!block) return ''

  return `## 你最近的工具调用轨迹(供理解上下文,知道你之前调过什么、返回了什么)
${block}`
}
