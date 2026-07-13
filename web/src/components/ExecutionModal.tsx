import { useEffect, useState, useRef } from 'react'
import { fetchJSON } from '../api/client'
import './ExecutionModal.css'

interface SubTaskLite {
  id: string
  name: string
  description: string
  assignee: string
  agentType?: 'permanent' | 'adhoc'
  agentName?: string
  status: string
  error?: string
  result?: string
  turnCount?: number
  retryCount?: number
  tokensInput?: number
  tokensOutput?: number
  startedAt?: string
}
interface TurnLite {
  id: string
  subtaskId: string
  turnIndex: number
  text: string
  startedAt: string
  endedAt?: string
}
interface MessageLite {
  id: string
  from: string
  to: string
  role: string
  parts: Array<{ kind: string; text?: string }>
  timestamp: string
}
interface TaskDetail {
  task: { id: string; name: string; status: string; subtasks: SubTaskLite[] }
  turnsBySubtask: Record<string, TurnLite[]>
  messagesBySubtask: Record<string, MessageLite[]>
}

type Step =
  | { kind: 'thought'; text: string; key: string }
  | { kind: 'tools'; tools: string[]; key: string }
  | { kind: 'message'; text: string; key: string }

const TOOL_ICONS: Record<string, string> = {
  Bash: '⚡', Read: '📄', Write: '✏️', Edit: '✏️', MultiEdit: '✏️', NotebookEdit: '✏️',
  Glob: '🔍', Grep: '🔍', WebFetch: '🌐', WebSearch: '🌐', Skill: '✨',
  TaskCreate: '📋', TaskUpdate: '📋', Workflow: '⚙️',
}
function toolIcon(name: string): string {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name]
  if (name.startsWith('mcp__')) return '🔌'
  return '🔧'
}
function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) {
    // mcp__server__method → method(或 server)
    const parts = name.split('__')
    return parts[parts.length - 1] || name
  }
  return name
}

// 把 turn 文本(思考 + 🔧 工具行)解析成扁平 step 流,相邻工具聚合
function buildSteps(turns: TurnLite[], messages: MessageLite[], subtaskId: string): Step[] {
  // 先按时间把 turn 和 Jarvis 补充指令合成有序事件
  type Ev = { time: number; turn?: TurnLite; msg?: MessageLite }
  const evs: Ev[] = []
  for (const t of turns) evs.push({ time: new Date(t.startedAt).getTime(), turn: t })
  for (const m of messages) {
    if (m.to !== subtaskId || m.role !== 'user') continue
    evs.push({ time: new Date(m.timestamp).getTime(), msg: m })
  }
  evs.sort((a, b) => a.time - b.time)

  const steps: Step[] = []
  let keySeq = 0
  const pushTools = (tools: string[]) => {
    if (!tools.length) return
    const last = steps[steps.length - 1]
    if (last && last.kind === 'tools') last.tools.push(...tools)   // 相邻工具聚合
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
    const lines = raw.split('\n')
    const tools: string[] = []
    const thoughtLines: string[] = []
    for (const ln of lines) {
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
function countTools(tools: string[]): Array<{ name: string; count: number }> {
  const order: string[] = []
  const counts: Record<string, number> = {}
  for (const t of tools) {
    if (!(t in counts)) { counts[t] = 0; order.push(t) }
    counts[t]++
  }
  return order.map(name => ({ name, count: counts[name] }))
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function ExecutionModal({ taskId, subtaskId, onClose }: { taskId: string; subtaskId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [directiveOpen, setDirectiveOpen] = useState(false)
  const timerRef = useRef<number | null>(null)

  // 拉详情;running 时 2s 轮询
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await fetchJSON<TaskDetail>(`/api/task/${taskId}`)
        if (cancelled) return
        setDetail(d)
        setLoading(false)
        const sub = d.task.subtasks.find(s => s.id === subtaskId)
        const active = sub && !['completed', 'failed', 'cancelled'].includes(sub.status)
        if (active) {
          timerRef.current = window.setTimeout(load, 2000)
        }
      } catch { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [taskId, subtaskId])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sub = detail?.task.subtasks.find(s => s.id === subtaskId)
  const turns = detail?.turnsBySubtask[subtaskId] || []
  const messages = detail?.messagesBySubtask?.[subtaskId] || []
  const steps = buildSteps(turns, messages, subtaskId)
  const toolCount = steps.reduce((n, s) => n + (s.kind === 'tools' ? s.tools.length : 0), 0)
  const thoughtCount = steps.filter(s => s.kind === 'thought').length
  const uiState = sub?.status === 'running' ? 'running' :
                  sub?.status === 'completed' ? 'done' :
                  sub?.status === 'failed' ? 'failed' : 'done'
  const lastEnd = turns.length ? turns[turns.length - 1].endedAt : undefined
  const elapsed = fmtDuration(sub?.startedAt, uiState === 'running' ? undefined : lastEnd)

  return (
    <div className="exm-mask" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="exm" data-state={uiState}>
        {loading ? (
          <div className="exm-loading">加载中…</div>
        ) : !sub ? (
          <div className="exm-empty">子任务不存在</div>
        ) : (
          <>
            <div className="exm-head">
              <span className="exm-dot"></span>
              <span className={`exm-type-badge ${sub.agentType || 'adhoc'}`}>
                {sub.agentType === 'permanent' ? '正式' : '临时'}
              </span>
              <span className="exm-title">{sub.agentName || sub.assignee}</span>
              <span className="exm-status">
                {uiState === 'running' ? '执行中' : uiState === 'done' ? '已完成' : '执行失败'}
              </span>
              <button className="exm-close" onClick={onClose}>✕</button>
            </div>
            <div className="exm-stats">
              <span>回合 <b>{sub.turnCount ?? turns.length}</b></span>
              <span>耗时 <b>{elapsed}</b></span>
              {toolCount > 0 ? <span>工具 <b>{toolCount}</b></span> : null}
              {thoughtCount > 0 ? <span>思考 <b>{thoughtCount}</b></span> : null}
              {sub.retryCount ? <span>重试 <b>{sub.retryCount}</b></span> : null}
              {(sub.tokensInput || sub.tokensOutput) ? <span>token <b>{sub.tokensInput || 0}/{sub.tokensOutput || 0}</b></span> : null}
            </div>
            {sub.error && <div className="exm-error">{sub.error}</div>}
            <div className="exm-directive">
              <div className="exm-directive-label">
                📋 任务指令
                <button className="exm-directive-toggle" onClick={() => setDirectiveOpen(o => !o)}>
                  {directiveOpen ? '收起' : '展开'}
                </button>
              </div>
              <div className={`exm-directive-text${directiveOpen ? '' : ' collapsed'}`}>{sub.description || sub.name}</div>
            </div>
            <div className="exm-body">
              {steps.length === 0 ? (
                <div className="exm-empty">暂无轨迹记录</div>
              ) : (
                <div className="exm-timeline">
                  {steps.map(step => {
                    if (step.kind === 'thought') {
                      return (
                        <div className="exm-step exm-step-thought" key={step.key}>
                          <span className="exm-node"></span>
                          <div className="exm-thought">{step.text}</div>
                        </div>
                      )
                    }
                    if (step.kind === 'tools') {
                      return (
                        <div className="exm-step exm-step-tools" key={step.key}>
                          <span className="exm-node"></span>
                          <div className="exm-tools">
                            {countTools(step.tools).map((t, i) => (
                              <span className="exm-tool-chip" key={i}>
                                <span className="exm-tool-ico">{toolIcon(t.name)}</span>
                                <span className="exm-tool-name">{toolLabel(t.name)}</span>
                                {t.count > 1 && <span className="exm-tool-count">×{t.count}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div className="exm-step exm-step-msg" key={step.key}>
                        <span className="exm-node exm-node-msg"></span>
                        <div className="exm-msg">
                          <div className="exm-msg-tag">💬 Jarvis 补充</div>
                          <div className="exm-msg-text">{step.text}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {sub.result && (
                <div className="exm-result">
                  <div className="exm-result-label">✅ 交付结果</div>
                  <div className="exm-result-text">{sub.result}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
