import { serverGet } from '../shared/server-client.js'
import { redactSecrets } from '../shared/redact.js'

/**
 * 小弟历史注入 —— 替代 SDK resume 黑盒。
 *
 * 从 Java 聚合端点 GET /api/subtask/{id}/full-history 拉上次同类任务的完整执行历史
 * (任务描述 + 每回合思考/工具名 + 工具参数/返回 + 跟 Jarvis 的沟通),按 turn_index
 * 为骨架合流成一段可读文字,注入下一个同类小弟的 prompt。可控、可截断(库里 50K 全量,
 * 这里 5K/2K 二次压缩)、可查询。
 */

/** 后端 full-history 返回结构(对齐 SubtaskFullHistory record)。 */
interface FullHistoryDTO {
  subtaskId: string
  taskId: string
  description: string
  turns: Array<{ turnIndex: number; text: string; startedAt: string }>
  toolTraces: Array<{
    turnIndex: number | null
    callIndex: number
    toolName: string
    args: string          // JSON 字符串
    resultText: string | null
    isError: boolean
    truncated: boolean
  }>
  comms: Array<{
    from: string
    to: string
    parts: Array<{ kind?: string; text?: string } | Record<string, unknown>>
    timestamp: string
  }>
}

/** 上下文层截断阈值(字符数)。库里已 50K 硬截断,这里进一步压缩喂 LLM。 */
const RESULT_TEXT_CONTEXT_LIMIT = 5_000
const ARGS_CONTEXT_LIMIT = 2_000
const SECTION_TOTAL_LIMIT = 30_000

function truncate(text: string, limit: number, hint: string): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n[...省略,${hint}]`
}

function prettyArgs(argsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argsJson))
  } catch {
    return argsJson
  }
}

/** comms 里 parts 摊平出纯文本。 */
function commText(parts: FullHistoryDTO['comms'][number]['parts']): string {
  const out: string[] = []
  for (const p of parts) {
    const t = (p as any)?.text
    if (typeof t === 'string') out.push(t)
  }
  return out.join('').trim()
}

/**
 * 拉一个历史 subtask 的完整执行记录,组装成 prompt 段落。
 * 失败/空数据返回空串,调用方据此决定是否插入。
 */
export async function getSubtaskHistoryForPrompt(userId: string, subtaskId: string): Promise<string> {
  let dto: FullHistoryDTO
  try {
    dto = await serverGet<FullHistoryDTO>(userId, `/api/subtask/${encodeURIComponent(subtaskId)}/full-history`)
  } catch {
    return ''
  }
  if (!dto) return ''

  // 按 turnIndex 分组 tool_traces
  const tracesByTurn = new Map<number, FullHistoryDTO['toolTraces']>()
  for (const t of dto.toolTraces) {
    const k = t.turnIndex ?? -1
    const arr = tracesByTurn.get(k) || []
    arr.push(t)
    tracesByTurn.set(k, arr)
  }

  // comms 按 timestamp 升序(Java 已排,这里稳妥再排一次),准备按 ts 插缝
  const comms = [...dto.comms].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  let commIdx = 0
  const fmtComm = (c: FullHistoryDTO['comms'][number]): string => {
    const text = commText(c.parts)
    if (!text) return ''
    const dir = c.from === 'jarvis' ? 'Jarvis→你' : `你→${c.to === 'jarvis' ? 'Jarvis' : c.to}`
    return `  💬 ${dir}: ${redactSecrets(truncate(text, ARGS_CONTEXT_LIMIT, '过长截断'))}`
  }

  const lines: string[] = [`### 上次任务:${redactSecrets(dto.description || '(无描述)')}`]

  const turns = [...dto.turns].sort((a, b) => a.turnIndex - b.turnIndex)
  for (const turn of turns) {
    // 早于本回合的沟通先吐
    while (commIdx < comms.length && comms[commIdx].timestamp < turn.startedAt) {
      const line = fmtComm(comms[commIdx]); commIdx++
      if (line) lines.push(line)
    }
    const turnText = (turn.text || '').trim()
    if (turnText && turnText !== '(无文本输出)') {
      lines.push(`[回合 ${turn.turnIndex}] ${redactSecrets(turnText)}`)
    }
    for (const tr of tracesByTurn.get(turn.turnIndex) || []) {
      lines.push(`    🔧 ${tr.toolName}`)
      const args = prettyArgs(tr.args)
      if (args && args !== '{}') lines.push(`       args: ${redactSecrets(truncate(args, ARGS_CONTEXT_LIMIT, `args 超 ${ARGS_CONTEXT_LIMIT}`))}`)
      if (tr.resultText) {
        const flag = (tr.truncated ? ' [库里已截断]' : '') + (tr.isError ? ' [错误]' : '')
        lines.push(`       → ${redactSecrets(truncate(tr.resultText, RESULT_TEXT_CONTEXT_LIMIT, `result 超 ${RESULT_TEXT_CONTEXT_LIMIT}`))}${flag}`)
      }
    }
  }
  // 收尾:晚于最后一个回合的沟通
  while (commIdx < comms.length) {
    const line = fmtComm(comms[commIdx]); commIdx++
    if (line) lines.push(line)
  }

  // 整段超 30K 从最老回合开始丢(保留段落头 + 尾部最新)
  let body = lines.join('\n')
  if (body.length > SECTION_TOTAL_LIMIT) {
    body = lines[0] + '\n[...上次记忆过长,已省略较早回合...]\n' + body.slice(body.length - SECTION_TOTAL_LIMIT)
  }
  if (lines.length <= 1) return ''  // 只有段落头,没实质内容

  return `## 你上次做类似任务的完整记忆(供接续,不必从零开始)\n${body}`
}
