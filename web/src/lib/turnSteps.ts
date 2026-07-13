// 把 agent 回合文本(思考 + `🔧 工具` 行)解析成可读的 step 流。
// turn.text 格式:纯文本思考 / `\n🔧 ToolName`(可多个) / 混合 / `(无文本输出)`

export type TurnLike = { id: string; turnIndex: number; text: string; startedAt: string }

export type Step =
  | { kind: 'thought'; text: string; key: string }
  | { kind: 'tools'; tools: string[]; key: string }

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

// turn 数组 → step 流,相邻工具聚合、丢弃空回合
export function parseTurnsToSteps(turns: TurnLike[]): Step[] {
  const sorted = [...turns].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
  const steps: Step[] = []
  let keySeq = 0
  const pushTools = (tools: string[]) => {
    if (!tools.length) return
    const last = steps[steps.length - 1]
    if (last && last.kind === 'tools') last.tools.push(...tools)
    else steps.push({ kind: 'tools', tools: [...tools], key: `s${keySeq++}` })
  }
  for (const t of sorted) {
    const raw = t.text
    if (!raw || raw === '(无文本输出)') continue
    const tools: string[] = []
    const thoughtLines: string[] = []
    for (const ln of raw.split('\n')) {
      const m = ln.match(/^🔧\s*(.+)$/)
      if (m) tools.push(m[1].trim())
      else if (ln.trim()) thoughtLines.push(ln)
    }
    const thought = thoughtLines.join('\n').trim()
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
