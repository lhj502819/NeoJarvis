import { useState, useEffect, useRef } from 'react'
import { fetchJSON } from '../../../api/client'
import type { TaskDetail as TaskDetailData, SubTaskTurn } from '../types'
import { buildStepsWithMessages, countTools, toolIcon, toolLabel, type MessageLike } from '../../../lib/turnSteps'
import { ArtifactPanel, type Artifact } from '../../../components/ArtifactPanel'

const ART_ICONS: Record<string, string> = { html: '🌐', markdown: '📄', code: '💻', mermaid: '📊' }

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.round((end - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function SubtaskTree({ subtask, turns, messages }: { subtask: TaskDetailData['task']['subtasks'][number]; turns: SubTaskTurn[]; messages: MessageLike[] }) {
  const [open, setOpen] = useState(false)
  const running = subtask.status === 'running'
  const lastEnd = turns.length ? turns[turns.length - 1].endedAt : undefined
  return (
    <div className="dash-card dash-subtask-tree">
      <div className="dash-subtask-tree-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} {subtask.name} · <span className="dash-accent-text">{subtask.assignee}</span></span>
        <span className={`dash-badge dash-badge-${subtask.status}`}>{subtask.status}</span>
      </div>
      <div className="dash-subtask-tree-meta">
        执行 {subtask.turnCount ?? turns.length} 回合 · 耗时 {fmtDuration(subtask.startedAt, running ? undefined : lastEnd)}
        {subtask.retryCount ? ` · 重试 ${subtask.retryCount} 次` : ''}
        {(subtask.tokensInput || subtask.tokensOutput) ? ` · token ${(subtask.tokensInput || 0)}/${(subtask.tokensOutput || 0)}` : ''}
      </div>
      {open && (
        <div className="dash-turns">
          {(() => {
            const steps = buildStepsWithMessages(turns, messages, subtask.id)
            if (steps.length === 0) return <div className="dash-empty-hint">无轨迹记录</div>
            return steps.map(step => {
              if (step.kind === 'thought') return <div className="dash-step-thought" key={step.key}>{step.text}</div>
              if (step.kind === 'message') return (
                <div className="dash-step-message" key={step.key}>
                  <span className="dash-step-message-tag">Jarvis 补充指令</span>
                  <span className="dash-step-message-text">{step.text}</span>
                </div>
              )
              return (
                <div className="dash-step-tools" key={step.key}>
                  {countTools(step.tools).map((t, i) => (
                    <span className="dash-tool-chip" key={i}>
                      <span>{toolIcon(t.name)}</span>
                      <span className="dash-tool-name">{toolLabel(t.name)}</span>
                      {t.count > 1 && <span className="dash-tool-count">×{t.count}</span>}
                    </span>
                  ))}
                </div>
              )
            })
          })()}
        </div>
      )}
      {open && subtask.result && (
        <div className="dash-subtask-result">
          <div className="dash-subtask-result-label">✅ 交付结果</div>
          <div className="dash-subtask-result-text">{subtask.result}</div>
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

      <div className="dash-section-title">子任务执行树</div>
      {task.subtasks.map(st => <SubtaskTree key={st.id} subtask={st} turns={turnsBySubtask[st.id] || []} messages={messagesBySubtask[st.id] || []} />)}

      {conversation && conversation.messages.length > 0 && (
        <>
          <div className="dash-section-title" style={{ marginTop: 16 }}>中途沟通 ({conversation.messages.length})</div>
          {conversation.messages.map(m => {
            const text = m.parts.find(p => p.kind === 'text')?.text || ''
            const fromJarvis = m.from === 'jarvis'
            return (
              <div className={`dash-conv-msg ${fromJarvis ? 'from-jarvis' : 'from-agent'}`} key={m.id}>
                <span className="dash-conv-who">{fromJarvis ? 'Jarvis' : '小弟'}</span>
                <span className="dash-conv-text">{text.slice(0, 300)}</span>
              </div>
            )
          })}
        </>
      )}

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
