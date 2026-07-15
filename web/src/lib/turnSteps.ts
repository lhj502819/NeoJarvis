// 把 agent 回合文本(思考 + `🔧 工具` 行)解析成可读的 step 流。
// turn.text 格式:纯文本思考 / `\n🔧 ToolName`(可多个) / 混合 / `(无文本输出)`

export type TurnLike = { id: string; turnIndex: number; text: string; startedAt: string }
export type MessageLike = {
  id: string
  from: string
  to: string
  role: string
  parts: Array<{ kind: string; text?: string }>
  timestamp: string
}

export type Step =
  | { kind: 'thought'; text: string; key: string }
  | { kind: 'tools'; tools: string[]; key: string }
  | { kind: 'message'; text: string; key: string }

const TOOL_ICONS: Record<string, string> = {
  Bash: '⚡', Read: '📄', Write: '✏️', Edit: '✏️', MultiEdit: '✏️', NotebookEdit: '✏️',
  Glob: '🔍', Grep: '🔍', WebFetch: '🌐', WebSearch: '🌐', Skill: '✨',
  TaskCreate: '📋', TaskUpdate: '📋', Workflow: '⚙️',
}

export function toolIcon(name: string): string {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name]
  if (name.startsWith('mcp__')) return '🔌'
  return '🔧'
}

export function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return parts[parts.length - 1] || name
  }
  return name
}

// 内部:一段 turn.text → thought/tools 序列(不 push,由外层聚合工具)
function turnToPieces(raw: string): { thought?: string; tools: string[] } {
  const tools: string[] = []
  const thoughtLines: string[] = []
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^🔧\s*(.+)$/)
    if (m) tools.push(m[1].trim())
    else if (ln.trim()) thoughtLines.push(ln)
  }
  const thought = thoughtLines.join('\n').trim() || undefined
  return { thought, tools }
}

// turn 数组 → step 流,相邻工具聚合、丢弃空回合
export function parseTurnsToSteps(turns: TurnLike[]): Step[] {
  return buildStepsWithMessages(turns, [], '')
}

// turns + Jarvis→subtask 消息合流,按时间排序,相邻工具聚合。
// subtaskId 用于过滤 messages(只取 to=subtaskId 且 role=user 的补充指令)。
export function buildStepsWithMessages(turns: TurnLike[], messages: MessageLike[], subtaskId: string): Step[] {
  type Ev = { time: number; turn?: TurnLike; msg?: MessageLike }
  const evs: Ev[] = []
  for (const t of turns) evs.push({ time: new Date(t.startedAt).getTime(), turn: t })
  for (const m of messages) {
    if (subtaskId && m.to !== subtaskId) continue
    if (m.role !== 'user') continue  // 只显示 Jarvis 给小弟的补充指令
    evs.push({ time: new Date(m.timestamp).getTime(), msg: m })
  }
  evs.sort((a, b) => a.time - b.time)

  const steps: Step[] = []
  let keySeq = 0
  const pushTools = (tools: string[]) => {
    if (!tools.length) return
    const last = steps[steps.length - 1]
    if (last && last.kind === 'tools') last.tools.push(...tools)
    else steps.push({ kind: 'tools', tools: [...tools], key: `s${keySeq++}` })
  }
  for (const ev of evs) {
    if (ev.msg) {
      const text = ev.msg.parts.map(p => p.text || '').join('').trim()
      if (text) steps.push({ kind: 'message', text, key: `s${keySeq++}` })
      continue
    }
    const raw = ev.turn!.text
    if (!raw || raw === '(无文本输出)') continue
    const { thought, tools } = turnToPieces(raw)
    if (thought) steps.push({ kind: 'thought', text: thought, key: `s${keySeq++}` })
    pushTools(tools)
  }
  return steps
}

// 工具数组 → 按名归并计数,保持首次出现顺序
export function countTools(tools: string[]): Array<{ name: string; count: number }> {
  const order: string[] = []
  const counts: Record<string, number> = {}
  for (const t of tools) {
    if (!(t in counts)) { counts[t] = 0; order.push(t) }
    counts[t]++
  }
  return order.map(name => ({ name, count: counts[name] }))
}
