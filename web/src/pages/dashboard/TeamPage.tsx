import { useState, useEffect } from 'react'
import { usePolling } from '../../api/hooks'
import { fetchJSON } from '../../api/client'
import { DetailDrawer } from '../../components/DetailDrawer'
import { ExecutionModal } from '../../components/ExecutionModal'
import type { Recipe, AgentSession } from './types'

type FilterTab = 'all' | 'builtin' | 'settled'

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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function dotClass(status: string): string {
  if (status === 'completed') return 'dash-timeline-dot-success'
  if (status === 'running') return 'dash-timeline-dot-running'
  if (status === 'failed') return 'dash-timeline-dot-failed'
  return 'dash-timeline-dot-default'
}

function AgentDetailPanel({
  recipe,
  sessions,
}: {
  recipe: Recipe
  sessions: AgentSession[]
}) {
  const [subtasks, setSubtasks] = useState<SubtaskRecord[]>([])
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)

  useEffect(() => {
    setSubtasks([])
    fetchJSON<SubtaskRecord[]>(`/api/recipe/${recipe.id}/subtasks`)
      .then(setSubtasks)
      .catch(() => {})
  }, [recipe.id])

  const isBuiltin = recipe.createdBy === 'builtin' || recipe.persistent

  const totalExecuted = recipe.usageCount ?? 0
  const successCount = subtasks.filter(s => s.status === 'completed').length
  const runningCount = subtasks.filter(s => s.status === 'running').length

  const recent = subtasks.slice(0, 5)

  return (
    <div className="dash-agent-detail">
      {/* Hero */}
      <div className="dash-agent-hero">
        <div className="dash-agent-avatar">
          <span>{recipe.name.slice(0, 1)}</span>
        </div>
        <div className="dash-agent-hero-info">
          <div className="dash-agent-hero-name">{recipe.name}</div>
          <span className={`dash-badge ${isBuiltin ? 'dash-badge-builtin' : 'dash-badge-settled'}`}>
            {isBuiltin ? '内置' : '沉淀'}
          </span>
        </div>
      </div>

      {/* Description */}
      {recipe.description && (
        <p className="dash-agent-desc">{recipe.description}</p>
      )}

      {/* 能力统计 */}
      <div className="dash-agent-stats-heading">能力统计</div>
      <div className="dash-agent-stats">
        <div className="dash-agent-stat">
          <span className="dash-agent-stat-value stat-cyan">{totalExecuted}</span>
          <span className="dash-agent-stat-label">已执行</span>
        </div>
        <div className="dash-agent-stat">
          <span className="dash-agent-stat-value stat-teal">{successCount}</span>
          <span className="dash-agent-stat-label">已成功</span>
        </div>
        <div className="dash-agent-stat">
          <span className="dash-agent-stat-value stat-purple">{runningCount}</span>
          <span className="dash-agent-stat-label">执行中</span>
        </div>
      </div>

      {/* 最近执行 */}
      <div className="dash-agent-stats-heading">最近执行</div>
      {recent.length > 0 ? (
        <div className="dash-agent-timeline">
          {recent.map(st => (
            <div
              className="dash-timeline-item dash-clickable"
              key={st.id}
              onClick={() => setModal({ taskId: st.taskId, subtaskId: st.id })}
              style={{ cursor: 'pointer' }}
            >
              <span className={`dash-timeline-dot ${dotClass(st.status)}`} />
              <div className="dash-timeline-content">
                <div className="dash-timeline-desc">{st.description.slice(0, 80)}</div>
                <div className="dash-timeline-time">{relativeTime(st.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length > 0 ? (
        <div className="dash-agent-timeline">
          {sessions.slice(0, 5).map(s => (
            <div className="dash-timeline-item" key={s.sessionId}>
              <span className="dash-timeline-dot dash-timeline-dot-success" />
              <div className="dash-timeline-content">
                <div className="dash-timeline-desc">{s.lastTaskDescription.slice(0, 80)}</div>
                <div className="dash-timeline-time">{s.completedAt ? relativeTime(s.completedAt) : '—'}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="dash-empty-hint">暂无执行记录</div>
      )}

      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}

function EmptyDrawer() {
  return (
    <div className="dash-drawer-empty">
      <div className="dash-drawer-empty-icon">👥</div>
      <div>点击左侧卡片查看 Agent 详情</div>
    </div>
  )
}

export function TeamPage() {
  const recipes = usePolling<Recipe[]>('/api/recipes', 10000)
  const history = usePolling<AgentSession[]>('/api/history', 10000)
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [tab, setTab] = useState<FilterTab>('all')

  const allRecipes = recipes ?? []

  const builtinRecipes = allRecipes.filter(r => r.createdBy === 'builtin' || r.persistent)
  const settledRecipes = allRecipes.filter(r => r.createdBy !== 'builtin' && !r.persistent)

  const filtered =
    tab === 'builtin' ? builtinRecipes :
    tab === 'settled' ? settledRecipes :
    allRecipes

  // auto-select first on load
  const effectiveSelected = selected ?? (allRecipes.length > 0 ? allRecipes[0] : null)

  const selectedSessions = history
    ? history.filter(s =>
        effectiveSelected &&
        (s.recipeId === effectiveSelected.id || s.recipeId === effectiveSelected.name)
      )
    : []

  return (
    <div className="dash-team-layout">
      {/* Left column */}
      <div className="dash-team-main">
        {/* Header */}
        <div className="tasks-page-header">
          <h1 className="tasks-page-title">团体</h1>
          <p className="tasks-page-subtitle">您的 AI 专家团体</p>
        </div>

        {/* Filter tabs */}
        <div className="dash-task-toolbar">
          <div className="dash-task-tabs">
            <button
              className={`dash-task-tab${tab === 'all' ? ' active' : ''}`}
              onClick={() => setTab('all')}
              type="button"
            >
              全体
              <span className="dash-task-tab-count">{allRecipes.length}</span>
            </button>
            <button
              className={`dash-task-tab${tab === 'builtin' ? ' active' : ''}`}
              onClick={() => setTab('builtin')}
              type="button"
            >
              内置
              <span className="dash-task-tab-count">{builtinRecipes.length}</span>
            </button>
            <button
              className={`dash-task-tab${tab === 'settled' ? ' active' : ''}`}
              onClick={() => setTab('settled')}
              type="button"
            >
              沉淀
              <span className="dash-task-tab-count">{settledRecipes.length}</span>
            </button>
          </div>
        </div>

        {/* Grid */}
        {filtered.length > 0 ? (
          <div className="dash-team-grid">
            {filtered.map(r => {
              const isBuiltin = r.createdBy === 'builtin' || r.persistent
              const isActive = effectiveSelected?.id === r.id
              return (
                <div
                  className={`dash-card dash-clickable${isActive ? ' dash-card-active' : ''}`}
                  key={r.id}
                  onClick={() => setSelected(r)}
                >
                  <div className="dash-team-card-head">
                    <span className="dash-agent-name">{r.name}</span>
                    <span className={`dash-badge ${isBuiltin ? 'dash-badge-builtin' : 'dash-badge-settled'}`}>
                      {isBuiltin ? '内置' : '沉淀'}
                    </span>
                  </div>
                  <div className="dash-agent-task">{r.description}</div>
                  <div className="dash-profile-meta">
                    <span>已执行 {r.usageCount ?? 0} 次</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="dash-empty-hint">暂无团队成员</div>
        )}
      </div>

      {/* Right drawer */}
      <div className="dash-team-drawer-wrap">
        <DetailDrawer
          onClose={() => setSelected(null)}
          onBack={undefined}
          parentLabel="团体"
        >
          {effectiveSelected ? (
            <AgentDetailPanel
              recipe={effectiveSelected}
              sessions={selectedSessions}
            />
          ) : (
            <EmptyDrawer />
          )}
        </DetailDrawer>
      </div>
    </div>
  )
}
