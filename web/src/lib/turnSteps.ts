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

/** 重设计的任务详情时间线事件:执行轨迹 + 收发消息合流,消息带方向/收发方/类型。 */
export type TimelineEvent =
  | { kind: 'thought'; text: string; key: string; time: number }
  | { kind: 'tools'; tools: string[]; key: string; time: number }
  | {
      kind: 'message'; key: string; time: number
      direction: 'outgoing' | 'incoming' | 'directive'  // 本小弟发出 / 别人发来 / Jarvis 指令
      fromId: string; toId: string
      fromName: string; toName: string
      msgKind?: 'progress' | 'question' | 'deliverable' | 'blocked'  // 从 [type] 前缀解析
      text: string
    }

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

// 小弟→Jarvis 的消息带 `[progress]`/`[question]`/`[deliverable]`/`[blocked]` 前缀(见 agent-comms.ts)。
// 解析出类型并剥掉前缀用于展示。无前缀返回原文。
const MSG_KINDS = ['progress', 'question', 'deliverable', 'blocked'] as const
function parseMsgKind(text: string): { msgKind?: typeof MSG_KINDS[number]; body: string } {
  const m = text.match(/^\s*\[(progress|question|deliverable|blocked)\]\s*/)
  if (m) return { msgKind: m[1] as typeof MSG_KINDS[number], body: text.slice(m[0].length) }
  return { body: text }
}

/**
 * 重设计任务详情:为单个小弟合成完整时间线 —— 执行轨迹(turns)+ 与他相关的所有消息
 * (他发出的 / 别人发给他的 / Jarvis 指令),按时间戳穿成一条线。
 *
 * messages 应传"和这个小弟相关的全集":任务级 conversation(小弟↔小弟、小弟↔Jarvis)
 * + 子任务级(Jarvis→小弟 补充指令)。这里按 from/to 是否等于 subtaskId 过滤 + 分类方向,
 * 让每个小弟都能看到自己的完整上下文(此前只显示 to===自己 的单向指令)。
 *
 * nameOf:把 subtaskId / 'jarvis' 映射成显示名。
 */
export function buildSubtaskTimeline(
  turns: TurnLike[],
  messages: MessageLike[],
  subtaskId: string,
  nameOf: (id: string) => string,
): TimelineEvent[] {
  const evs: TimelineEvent[] = []
  let keySeq = 0

  // ① 执行轨迹:每个 turn 拆成 thought / tools 事件,挂 turn 的 startedAt
  for (const t of turns) {
    const time = new Date(t.startedAt).getTime()
    const raw = t.text
    if (!raw || raw === '(无文本输出)') continue
    const { thought, tools } = turnToPieces(raw)
    if (thought) evs.push({ kind: 'thought', text: thought, key: `e${keySeq++}`, time })
    if (tools.length) evs.push({ kind: 'tools', tools, key: `e${keySeq++}`, time })
  }

  // ② 消息:只取与本小弟相关的(收或发),去重(任务级+子任务级可能有重叠 id)
  const seen = new Set<string>()
  for (const m of messages) {
    if (seen.has(m.id)) continue
    const related = m.from === subtaskId || m.to === subtaskId
    if (!related) continue
    seen.add(m.id)
    const rawText = m.parts.map(p => p.text || '').join('').trim()
    if (!rawText) continue
    const { msgKind, body } = parseMsgKind(rawText)
    const direction: 'outgoing' | 'incoming' | 'directive' =
      m.from === subtaskId ? 'outgoing' : m.from === 'jarvis' ? 'directive' : 'incoming'
    evs.push({
      kind: 'message', key: `e${keySeq++}`, time: new Date(m.timestamp).getTime(),
      direction, fromId: m.from, toId: m.to,
      fromName: nameOf(m.from), toName: nameOf(m.to),
      msgKind, text: body,
    })
  }

  // ③ 按时间升序;相邻同名工具事件合并(减少碎片)
  evs.sort((a, b) => a.time - b.time)
  const merged: TimelineEvent[] = []
  for (const ev of evs) {
    const last = merged[merged.length - 1]
    if (ev.kind === 'tools' && last && last.kind === 'tools') {
      last.tools.push(...ev.tools)
    } else {
      merged.push(ev)
    }
  }
  return merged
}
