import { useEffect, useState, useRef } from 'react'
import { fetchJSON } from '../api/client'
import { buildSubtaskTimeline, countTools, toolIcon, toolLabel, type MessageLike, type TimelineEvent } from '../lib/turnSteps'
import { AgentAvatar } from './AgentAvatar'
import { ThoughtStep } from './ThoughtStep'
import './ExecutionModal.css'

interface SubTaskLite {
  id: string
  name: string
  description: string
  assignee: string
  domain?: string
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
  conversation?: {
    contextId: string
    participants: string[]
    messages: MessageLite[]
  } | null
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function fmtClock2(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const EXM_MSG_KIND_LABEL: Record<string, string> = {
  progress: '进展', question: '请示', deliverable: '交付', blocked: '受阻',
}

/** 时间线消息气泡(与 TaskDetail 的 MessageBubble 同款,复用 .tl-* 样式)。 */
function ExmMessageBubble({ ev }: { ev: Extract<TimelineEvent, { kind: 'message' }> }) {
  const dirClass = ev.direction === 'outgoing' ? 'outgoing' : ev.direction === 'directive' ? 'from-jarvis' : 'incoming'
  const kindLabel = ev.direction === 'directive' ? '补充指令' : (ev.msgKind ? EXM_MSG_KIND_LABEL[ev.msgKind] : '')
  const kindCls = ev.direction === 'directive' ? 'directive' : (ev.msgKind || '')
  return (
    <div className={`tl-msg ${dirClass}`}>
      <AgentAvatar seed={ev.fromId} fallback={ev.fromName} size={26} className="tl-msg-av" />
      <div className="tl-bubble">
        <div className="tl-bubble-who">
          <span>{ev.fromName}</span>
          <span className="tl-bubble-arrow">→ {ev.toName}</span>
          {kindLabel && <span className={`tl-kind tl-kind-${kindCls}`}>{kindLabel}</span>}
          <span className="tl-bubble-time">{fmtClock2(ev.time)}</span>
        </div>
        <div className="tl-bubble-txt">{ev.text.slice(0, 600)}</div>
      </div>
    </div>
  )
}

export function ExecutionModal({ taskId, subtaskId, onClose }: { taskId: string; subtaskId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [directiveOpen, setDirectiveOpen] = useState(false)
  const [showTrace, setShowTrace] = useState(false)
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
  // 合并该小弟的完整上下文:子任务级(Jarvis→他 指令) + 任务级 conversation(小弟↔小弟、小弟↔Jarvis)。
  // buildSubtaskTimeline 内部按 from/to 过滤 + 分类方向,与任务 tab 的详情一致。
  const messages: MessageLike[] = [...(detail?.messagesBySubtask?.[subtaskId] || []), ...(detail?.conversation?.messages || [])]
  const nameOf = (who: string): string => {
    if (who === 'jarvis') return 'Jarvis'
    const st = detail?.task.subtasks.find(s => s.id === who)
    if (!st) return '小弟'
    return (st.domain || st.name || '小弟').slice(0, 12)
  }
  const events = buildSubtaskTimeline(turns, messages, subtaskId, nameOf)
  const toolCount = events.reduce((n, e) => n + (e.kind === 'tools' ? e.tools.length : 0), 0)
  const thoughtCount = events.filter(e => e.kind === 'thought').length
  // 默认只显示沟通气泡;思考/工具折叠在"展开执行轨迹"后。
  const traceCount = events.filter(e => e.kind !== 'message').length
  const shownEvents = showTrace ? events : events.filter(e => e.kind === 'message')
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
              {events.length === 0 ? (
                <div className="exm-empty">暂无轨迹记录</div>
              ) : (
                <>
                  {traceCount > 0 && (
                    <button className="tl-trace-toggle" onClick={() => setShowTrace(s => !s)} type="button">
                      {showTrace ? '▾ 收起执行轨迹' : `▸ 展开执行轨迹（${traceCount} 步思考/工具）`}
                    </button>
                  )}
                  {shownEvents.length > 0 ? (
                    <div className="tl">
                      {shownEvents.map(ev => {
                        if (ev.kind === 'thought') return (
                          <div className="tl-ev tl-ev-thought" key={ev.key}>
                            <div className="tl-ev-time">{fmtClock2(ev.time)}</div>
                            <ThoughtStep text={ev.text} />
                          </div>
                        )
                        if (ev.kind === 'tools') return (
                          <div className="tl-ev tl-ev-tools" key={ev.key}>
                            <div className="tl-ev-time">{fmtClock2(ev.time)}</div>
                            <div className="tl-tools">
                              {countTools(ev.tools).map((t, i) => (
                                <span className="dash-tool-chip" key={i}>
                                  <span>{toolIcon(t.name)}</span>
                                  <span className="dash-tool-name">{toolLabel(t.name)}</span>
                                  {t.count > 1 && <span className="dash-tool-count">×{t.count}</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                        return (
                          <div className="tl-ev tl-ev-msg" key={ev.key}>
                            <ExmMessageBubble ev={ev} />
                          </div>
                        )
                      })}
                    </div>
                  ) : (!showTrace && (
                    <div className="exm-empty" style={{ padding: '4px 0' }}>本小弟无对外沟通,执行轨迹见上方展开</div>
                  ))}
                </>
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
