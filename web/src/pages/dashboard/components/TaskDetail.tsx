import { useState, useEffect, useRef } from 'react'
import { fetchJSON } from '../../../api/client'
import type { TaskDetail as TaskDetailData, SubTaskTurn } from '../types'
import { buildSubtaskTimeline, countTools, toolIcon, toolLabel, type MessageLike, type TimelineEvent } from '../../../lib/turnSteps'
import { AgentAvatar } from '../../../components/AgentAvatar'
import { ThoughtStep } from '../../../components/ThoughtStep'
import { ArtifactPanel, type Artifact } from '../../../components/ArtifactPanel'

const ART_ICONS: Record<string, string> = { html: '🌐', markdown: '📄', code: '💻', mermaid: '📊' }

const MSG_KIND_LABEL: Record<string, string> = {
  progress: '进展', question: '请示', deliverable: '交付', blocked: '受阻',
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.round((end - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtClock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 一条消息气泡(时间线内)。方向:outgoing 本小弟发出 / incoming 别人发来 / directive Jarvis 指令 */
function MessageBubble({ ev }: { ev: Extract<TimelineEvent, { kind: 'message' }> }) {
  const dirClass =
    ev.direction === 'outgoing' ? 'outgoing' : ev.direction === 'directive' ? 'from-jarvis' : 'incoming'
  // 头像种子:发送方 id(jarvis 固定色)。emoji 拿不到(接口无 avatar),走首字母兜底。
  const avSeed = ev.fromId
  const kindLabel = ev.direction === 'directive' ? '补充指令' : (ev.msgKind ? MSG_KIND_LABEL[ev.msgKind] : '')
  const kindCls = ev.direction === 'directive' ? 'directive' : (ev.msgKind || '')
  return (
    <div className={`tl-msg ${dirClass}`}>
      <AgentAvatar seed={avSeed} fallback={ev.fromName} size={26} className="tl-msg-av" />
      <div className="tl-bubble">
        <div className="tl-bubble-who">
          <span>{ev.fromName}</span>
          <span className="tl-bubble-arrow">→ {ev.toName}</span>
          {kindLabel && <span className={`tl-kind tl-kind-${kindCls}`}>{kindLabel}</span>}
          <span className="tl-bubble-time">{fmtClock(ev.time)}</span>
        </div>
        <div className="tl-bubble-txt">{ev.text.slice(0, 600)}</div>
      </div>
    </div>
  )
}

function SubtaskLane({
  subtask, turns, messages, nameOf, defaultOpen,
}: {
  subtask: TaskDetailData['task']['subtasks'][number]
  turns: SubTaskTurn[]
  messages: MessageLike[]
  nameOf: (id: string) => string
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const running = subtask.status === 'running'
  const lastEnd = turns.length ? turns[turns.length - 1].endedAt : undefined
  const stDot = running ? 'running' : subtask.status === 'failed' || subtask.status === 'cancelled' ? 'failed' : 'done'
  const events = buildSubtaskTimeline(turns, messages, subtask.id, nameOf)
  // 默认只显示沟通气泡 + 交付;思考💭/工具🔧 属于执行过程,折叠在"展开执行轨迹"后面。
  const [showTrace, setShowTrace] = useState(false)
  const traceCount = events.filter(e => e.kind !== 'message').length
  const shownEvents = showTrace ? events : events.filter(e => e.kind === 'message')
  const msgCount = events.length - traceCount

  return (
    <div className={`tl-lane${open ? ' open' : ''}`} data-state={stDot}>
      <div className="tl-lane-head" onClick={() => setOpen(!open)}>
        <AgentAvatar seed={subtask.assignee} fallback={subtask.domain || subtask.name} size={34} className="tl-lane-av" />
        <div className="tl-lane-meta">
          <div className="tl-lane-row1">
            <span className={`tl-st-dot tl-st-${stDot}`}></span>
            <span className="tl-lane-name">{subtask.domain || subtask.name}</span>
            <span className={`tl-type tl-type-${subtask.agentType || 'adhoc'}`}>
              {subtask.agentType === 'permanent' ? '正式' : '临时'}
            </span>
          </div>
          <div className="tl-lane-sub">{subtask.name} · {subtask.status}</div>
        </div>
        <div className="tl-lane-stat">
          {subtask.turnCount ?? turns.length} 回合 · {fmtDuration(subtask.startedAt, running ? undefined : lastEnd)}
          {(subtask.tokensInput || subtask.tokensOutput) ? <><br />token {(subtask.tokensInput || 0)}/{(subtask.tokensOutput || 0)}</> : null}
        </div>
        <span className="tl-chev">▸</span>
      </div>
      {open && (
        <div className="tl-lane-body">
          {events.length === 0 ? (
            <div className="dash-empty-hint">无轨迹记录</div>
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
                        <div className="tl-ev-time">{fmtClock(ev.time)}</div>
                        <ThoughtStep text={ev.text} />
                      </div>
                    )
                    if (ev.kind === 'tools') return (
                      <div className="tl-ev tl-ev-tools" key={ev.key}>
                        <div className="tl-ev-time">{fmtClock(ev.time)}</div>
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
                        <MessageBubble ev={ev} />
                      </div>
                    )
                  })}
                </div>
              ) : (!showTrace && msgCount === 0 && (
                <div className="dash-empty-hint" style={{ padding: '4px 0' }}>本小弟无对外沟通,执行轨迹见上方展开</div>
              ))}
            </>
          )}
          {subtask.result && (
            <div className="dash-subtask-result">
              <div className="dash-subtask-result-label">✅ 交付结果</div>
              <div className="dash-subtask-result-text">{subtask.result}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Artifact | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await fetchJSON<TaskDetailData>(`/api/task/${taskId}`)
        if (cancelled) return
        setDetail(d)
        setLoading(false)
        const active = !['completed', 'failed', 'cancelled'].includes(d.task.status)
        if (active) {
          timerRef.current = window.setTimeout(load, 2000)  // 仅进行中轮询
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [taskId])

  if (loading) return <div><button className="dash-back-btn" onClick={onBack}>← 返回任务</button><div className="dash-skeleton">加载中…</div></div>
  if (!detail) return <div><button className="dash-back-btn" onClick={onBack}>← 返回任务</button><div className="dash-empty-hint">任务不存在</div></div>

  const { task, turnsBySubtask, conversation } = detail
  const messagesBySubtask = detail.messagesBySubtask || {}
  const artifacts = detail.artifacts || []

  const openArtifact = async (id: string) => {
    try {
      // v0.3: Java 返回 content|uri 之一, ArtifactPanel 的 effect 会解析后再渲染。
      const full = await fetchJSON<{ type: string; title: string; content?: string; uri?: string; language?: string }>(`/api/artifact/${id}`)
      setPreview({
        type: full.type as Artifact['type'],
        title: full.title,
        content: full.content,
        uri: full.uri,
        language: full.language,
      })
    } catch { /* ignore */ }
  }
  const totalTurns = task.subtasks.reduce((s, st) => s + (st.turnCount ?? 0), 0)
  const totalTokIn = task.subtasks.reduce((s, st) => s + (st.tokensInput ?? 0), 0)
  const totalTokOut = task.subtasks.reduce((s, st) => s + (st.tokensOutput ?? 0), 0)

  // subtaskId / 'jarvis' → 显示名(优先 domain,退回 name)。用于时间线消息的收发方标注。
  const nameOf = (who: string): string => {
    if (who === 'jarvis') return 'Jarvis'
    const st = task.subtasks.find(s => s.id === who)
    if (!st) return '小弟'
    return (st.domain || st.name || '小弟').slice(0, 12)
  }

  // 每个小弟的相关消息 = 子任务级(Jarvis→他 的补充指令) + 任务级 conversation(小弟↔小弟、
  // 小弟↔Jarvis)。buildSubtaskTimeline 内部再按 from/to 过滤 + 去重,这里只管把两个来源并起来。
  const taskMsgs = conversation?.messages || []
  const msgsFor = (subId: string) => [...(messagesBySubtask[subId] || []), ...taskMsgs]

  // 默认展开策略:running 的小弟自动展开(用户正盯着的);全完成时展开第一个,避免整页收起显得空。
  const anyRunning = task.subtasks.some(s => s.status === 'running')

  return (
    <div>
      <button className="dash-back-btn" onClick={onBack}>← 返回任务</button>
      <div className="dash-detail-head">
        <div className="dash-section-title" style={{ margin: 0 }}>{task.name}</div>
        <span className={`dash-badge dash-badge-${task.status}`}>{task.status}</span>
      </div>
      <div className="dash-task-id-mono dash-detail-id">{task.id} · 创建 {task.createdAt.slice(5, 16).replace('T', ' ')}</div>

      <div className="dash-detail-stats">
        <div className="dash-detail-stat"><b>{fmtDuration(task.createdAt, ['completed', 'failed', 'cancelled'].includes(task.status) ? task.updatedAt : undefined)}</b><span>总耗时</span></div>
        <div className="dash-detail-stat"><b>{task.subtasks.length}</b><span>子任务</span></div>
        <div className="dash-detail-stat"><b>{totalTurns}</b><span>执行回合</span></div>
        <div className="dash-detail-stat"><b>{totalTokIn}/{totalTokOut}</b><span>token 入/出</span></div>
      </div>

      <div className="dash-task-desc" style={{ marginBottom: 12 }}>{task.description}</div>

      <div className="dash-section-title">执行时间线 · 每个小弟的完整上下文</div>
      {task.subtasks.map((st, i) => (
        <SubtaskLane
          key={st.id}
          subtask={st}
          turns={turnsBySubtask[st.id] || []}
          messages={msgsFor(st.id)}
          nameOf={nameOf}
          defaultOpen={st.status === 'running' || (!anyRunning && i === 0)}
        />
      ))}

      {task.result && (
        <>
          <div className="dash-section-title" style={{ marginTop: 16 }}>结果</div>
          <div className="dash-card dash-result-box">{task.result}</div>
        </>
      )}

      {artifacts.length > 0 && (
        <>
          <div className="dash-section-title" style={{ marginTop: 16 }}>产出制品 ({artifacts.length})</div>
          <div className="dash-artifact-list">
            {artifacts.map(a => (
              <div className="dash-card dash-clickable dash-artifact-item" key={a.id} onClick={() => openArtifact(a.id)}>
                <span className="dash-artifact-ico">{ART_ICONS[a.type] || '📎'}</span>
                <span className="dash-artifact-title">{a.title}</span>
                <span className="dash-artifact-type">{a.type}</span>
                {a.version > 1 && <span className="dash-artifact-ver">v{a.version}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {preview && (
        <div className="dash-artifact-overlay" onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}>
          <div className="dash-artifact-overlay-panel">
            <ArtifactPanel artifact={preview} onClose={() => setPreview(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
