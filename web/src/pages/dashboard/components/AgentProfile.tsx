import { useState, useEffect } from 'react'
import { fetchJSON } from '../../../api/client'
import { ExecutionModal } from '../../../components/ExecutionModal'
import type { Recipe, AgentSession } from '../types'

interface SubtaskRecord {
  id: string
  taskId: string
  name: string
  description: string
  status: string
  domain?: string
  turnCount?: number
  createdAt: string
}

export function AgentProfile({ recipe, sessions, onBack }: { recipe: Recipe; sessions: AgentSession[]; onBack: () => void }) {
  const domain = recipe.name.replace(/专家$/, '')
  const mine = sessions.filter(s =>
    s.recipeId === recipe.id ||
    s.recipeId === recipe.name ||
    s.recipeId === domain ||
    s.domain === domain
  )

  const [subtasks, setSubtasks] = useState<SubtaskRecord[]>([])
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)

  useEffect(() => {
    fetchJSON<SubtaskRecord[]>(`/api/recipe/${recipe.id}/subtasks`).then(setSubtasks).catch(() => {})
  }, [recipe.id])

  return (
    <div>
      <button className="dash-back-btn" onClick={onBack}>← 返回团队</button>
      <div className="dash-section-title">{recipe.name}</div>
      <div className="dash-card">
        <div className="dash-agent-task">{recipe.description}</div>
        <div className="dash-profile-meta">
          <span>{recipe.createdBy === 'builtin' ? '内置' : '沉淀专家'}</span>
          <span>已执行 {recipe.usageCount} 次</span>
          <span>{recipe.lastUsedAt ? `最后: ${recipe.lastUsedAt.slice(0, 10)}` : '未使用'}</span>
        </div>
      </div>

      <div className="dash-section-title" style={{ marginTop: 16 }}>执行过的任务 ({subtasks.length || mine.length})</div>
      {subtasks.length > 0 ? subtasks.map(st => (
        <div className="dash-card dash-clickable" key={st.id} onClick={() => setModal({ taskId: st.taskId, subtaskId: st.id })}>
          <div className="dash-agent-task">{st.description.slice(0, 120)}</div>
          <div className="dash-profile-meta">
            <span className={`dash-status-dot ${st.status}`}></span>
            <span>{st.status === 'completed' ? '已完成' : st.status === 'running' ? '执行中' : st.status}</span>
            {st.turnCount != null && <span>回合 {st.turnCount}</span>}
            <span>{st.createdAt.slice(0, 10)}</span>
          </div>
        </div>
      )) : mine.length > 0 ? mine.map(s => (
        <div className="dash-card" key={s.sessionId}>
          <div className="dash-agent-task">{s.lastTaskDescription.slice(0, 100)}</div>
          <div className="dash-profile-meta">
            <span>领域: {s.domain || '—'}</span>
            <span>{s.taskCount} 次</span>
          </div>
        </div>
      )) : <div className="dash-empty-hint">暂无执行记录</div>}

      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}
