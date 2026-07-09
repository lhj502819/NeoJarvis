import { useState, useEffect, useRef } from 'react'
import { fetchJSON } from '../../../api/client'
import type { TaskDetail as TaskDetailData, SubTaskTurn } from '../types'

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.round((end - start) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function SubtaskTree({ subtask, turns }: { subtask: TaskDetailData['task']['subtasks'][number]; turns: SubTaskTurn[] }) {
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
          {turns.length > 0 ? turns.map(t => (
            <div className="dash-turn" key={t.id}>
              <span className="dash-turn-idx">[{t.turnIndex}]</span>
              <span className="dash-turn-text">{t.text.slice(0, 200)}</span>
            </div>
          )) : <div className="dash-empty-hint">无轨迹记录</div>}
        </div>
      )}
    </div>
  )
}

export function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null)
  const [loading, setLoading] = useState(true)
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
      {task.subtasks.map(st => <SubtaskTree key={st.id} subtask={st} turns={turnsBySubtask[st.id] || []} />)}

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
    </div>
  )
}
