import { useState, useMemo } from 'react'
import { usePolling, useSSE, type SSEEvent } from '../api/hooks'
import { postJSON } from '../api/client'
import type { AuthUser } from '../api/auth'
import './DashboardPage.css'

interface Task {
  id: string
  name: string
  description: string
  status: string
  subtasks: SubTask[]
  result?: string
  createdAt: string
  updatedAt: string
}

interface SubTask {
  id: string
  name: string
  assignee: string
  domain?: string
  status: string
  progress?: string
  result?: string
}

interface RunningAgent {
  taskId: string
  subtaskId: string
  name: string
  recipeId: string
  description: string
  startedAt: number
  url?: string
}

interface Recipe {
  id: string
  name: string
  description: string
  persistent: boolean
  usageCount: number
  createdBy: string
  lastUsedAt: string
}

interface AgentSession {
  sessionId: string
  recipeId: string
  domain: string
  topics: string[]
  lastTaskDescription: string
  completedAt: string
  taskCount: number
}

interface JarvisState {
  mood: number
  energy: number
  confidence: number
  familiarity: number
  trustLevel: number
  tasksCompletedToday: number
  messagesHandledToday: number
}

interface DashboardProps {
  user: AuthUser
  onLogout: () => void
}

export function DashboardPage({ user, onLogout }: DashboardProps) {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 2000)
  const stateData = usePolling<JarvisState>('/api/state', 3000)
  const agentsData = usePolling<RunningAgent[]>('/api/agents', 2000)
  const historyData = usePolling<AgentSession[]>('/api/history', 5000)
  const recipesData = usePolling<Recipe[]>('/api/recipes', 10000)
  const { events, connected } = useSSE('/events')

  const tasks = tasksData?.tasks || []

  return (
    <div className="dash-app">
      <header className="dash-header">
        <div className="dash-header-left">
          <div className="dash-logo">J</div>
          <span className="dash-header-title">Jarvis Dashboard</span>
        </div>
        <div className="dash-header-right">
          <a href="#/" className="dash-nav-link">对话</a>
          <span style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}>{user.displayName || user.username}</span>
          <button onClick={onLogout} style={{ fontSize: 12, color: 'var(--dash-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>退出</button>
          <div className="dash-header-status">
            <div className={`dash-status-dot ${connected ? '' : 'offline'}`} />
            <span>{connected ? '已连接' : '未连接'}</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <TasksPanel tasks={tasks} />
      </main>

      <aside className="dash-sidebar">
        <AgentsPanel agents={agentsData} history={historyData} recipes={recipesData} />
        <div style={{ marginTop: 20 }}>
          <JarvisStateCard state={stateData} />
        </div>
        <div style={{ marginTop: 20 }}>
          <ActivityFeed events={events} />
        </div>
      </aside>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`dash-badge dash-badge-${status}`}>{status}</span>
}

function SubTaskItem({ subtask }: { subtask: SubTask }) {
  return (
    <div className="dash-subtask">
      <span className="dash-subtask-name">{subtask.name}</span>
      <StatusBadge status={subtask.status} />
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(
    !['completed', 'failed', 'cancelled'].includes(task.status)
  )

  return (
    <div className="dash-card dash-task-card" onClick={() => setExpanded(!expanded)}>
      <div className="dash-task-header">
        <span className="dash-task-name">{task.name}</span>
        <StatusBadge status={task.status} />
      </div>
      <div className="dash-task-desc">{task.description}</div>
      <span className="dash-task-id">{task.id}</span>
      {expanded && task.subtasks && task.subtasks.length > 0 && (
        <div className="dash-subtasks">
          {task.subtasks.map(st => <SubTaskItem key={st.id} subtask={st} />)}
        </div>
      )}
    </div>
  )
}

function TasksPanel({ tasks }: { tasks: Task[] }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="dash-empty-state">
        <div className="dash-empty-icon">&#9745;</div>
        <div>没有任务</div>
      </div>
    )
  }

  const active = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const done = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <div>
      {active.length > 0 && (
        <div>
          <div className="dash-section-title">进行中 ({active.length})</div>
          {active.map(t => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
      <div style={{ marginTop: active.length > 0 ? 20 : 0 }}>
        <div className="dash-section-title">历史任务 ({done.length})</div>
        {done.length > 0
          ? done.slice(0, 20).map(t => <TaskCard key={t.id} task={t} />)
          : <div style={{ fontSize: 13, color: 'var(--dash-text-muted)', padding: '8px 0' }}>暂无</div>
        }
      </div>
    </div>
  )
}

function RunningAgentCard({ agent }: { agent: RunningAgent }) {
  const elapsed = Math.round((Date.now() - agent.startedAt) / 1000)
  const formatTime = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  const handleInterrupt = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await postJSON('/api/agent/interrupt', { subtaskId: agent.subtaskId })
  }

  return (
    <div className="dash-card dash-agent-card" style={{ borderLeft: '3px solid var(--dash-blue)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="dash-agent-name">{agent.name}</span>
        <span className="dash-badge dash-badge-running">running</span>
      </div>
      <div className="dash-agent-url">{agent.recipeId} · {agent.url || 'direct'}</div>
      {agent.description && (
        <div className="dash-agent-task">{agent.description}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--dash-text-muted)', marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{formatTime(elapsed)} · subtask {agent.subtaskId?.slice(0, 6)}</span>
        <button onClick={handleInterrupt} className="dash-btn-interrupt">打断</button>
      </div>
    </div>
  )
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const isBuiltin = recipe.createdBy === 'builtin'
  return (
    <div className="dash-card dash-agent-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="dash-agent-name">{recipe.name}</span>
        <span className="dash-badge" style={{ background: isBuiltin ? 'var(--dash-bg-hover)' : 'var(--dash-accent-light)', color: isBuiltin ? 'var(--dash-text-muted)' : 'var(--dash-accent)' }}>
          {isBuiltin ? '内置' : '沉淀'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginTop: 4 }}>
        {recipe.description}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dash-text-muted)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>已执行 {recipe.usageCount} 次</span>
        <span>{recipe.lastUsedAt ? `最后: ${recipe.lastUsedAt.slice(0, 10)}` : '未使用'}</span>
      </div>
    </div>
  )
}

function HistoryCard({ session }: { session: AgentSession }) {
  const date = new Date(session.completedAt)
  const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`

  return (
    <div className="dash-card dash-agent-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="dash-agent-name" style={{ fontSize: 13 }}>{session.recipeId}</span>
        <span style={{ fontSize: 11, color: 'var(--dash-text-muted)' }}>{timeStr}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginTop: 4 }}>
        {session.lastTaskDescription.slice(0, 80)}{session.lastTaskDescription.length > 80 ? '...' : ''}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dash-text-muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>关键词: {session.topics.slice(0, 4).join(', ')}</span>
        <span>{session.taskCount}次</span>
      </div>
      <div style={{ fontSize: 10, fontFamily: 'var(--dash-mono)', color: 'var(--dash-text-muted)', marginTop: 3 }}>
        session {session.sessionId.slice(0, 12)}...
      </div>
    </div>
  )
}

function AgentsPanel({ agents, history, recipes }: { agents: RunningAgent[] | null; history: AgentSession[] | null; recipes: Recipe[] | null }) {
  const [tab, setTab] = useState('team')
  const [search, setSearch] = useState('')

  const filteredHistory = useMemo(() => {
    if (!history) return []
    if (!search.trim()) return history
    const q = search.toLowerCase()
    return history.filter(s =>
      s.lastTaskDescription.toLowerCase().includes(q) ||
      s.topics.some(t => t.toLowerCase().includes(q)) ||
      s.recipeId.toLowerCase().includes(q)
    )
  }, [history, search])

  const filteredRecipes = useMemo(() => {
    if (!recipes) return []
    if (!search.trim()) return recipes
    const q = search.toLowerCase()
    return recipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    )
  }, [recipes, search])

  const runningCount = agents?.length || 0
  const teamCount = recipes?.length || 0
  const historyCount = history?.length || 0

  return (
    <div>
      <div className="dash-tabs">
        {[
          { id: 'team', label: `团队 (${teamCount})` },
          { id: 'running', label: `运行中 (${runningCount})` },
          { id: 'history', label: `历史 (${historyCount})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`dash-tab ${tab === t.id ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="搜索 agent / 任务 / 关键词..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="dash-search"
        />
      </div>

      {tab === 'team' && (
        <div>
          {filteredRecipes.length > 0 ? (
            filteredRecipes.map(r => <RecipeCard key={r.id} recipe={r} />)
          ) : (
            <div className="dash-empty-state" style={{ padding: '16px 10px' }}>
              <div className="dash-empty-icon">&#128101;</div>
              <div>暂无团队成员</div>
            </div>
          )}
        </div>
      )}

      {tab === 'running' && (
        <div>
          {agents && agents.length > 0 ? (
            agents.map(a => <RunningAgentCard key={a.subtaskId} agent={a} />)
          ) : (
            <div className="dash-empty-state" style={{ padding: '16px 10px' }}>
              <div className="dash-empty-icon">&#9899;</div>
              <div>当前无运行中的 Agent</div>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {filteredHistory.length > 0 ? (
            filteredHistory.slice().reverse().map(s => (
              <HistoryCard key={s.sessionId} session={s} />
            ))
          ) : (
            <div className="dash-empty-state" style={{ padding: '16px 10px' }}>
              <div className="dash-empty-icon">&#128218;</div>
              <div>{search ? '没有匹配的记录' : '暂无历史记录'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  const pct = Math.round((value / 100) * 100)
  return (
    <div className="dash-stat-row">
      <span className="dash-stat-label">{label}</span>
      <div className="dash-stat-bar">
        <div className={`dash-stat-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="dash-stat-value">{value}</span>
    </div>
  )
}

function JarvisStateCard({ state }: { state: JarvisState | null }) {
  if (!state) return null

  return (
    <div>
      <div className="dash-section-title">Jarvis 状态</div>
      <div className="dash-card dash-state-card">
        <StatBar label="心情" value={state.mood} colorClass="mood" />
        <StatBar label="精力" value={state.energy} colorClass="energy" />
        <StatBar label="把握度" value={state.confidence} colorClass="confidence" />
        <StatBar label="了解度" value={state.familiarity} colorClass="familiarity" />
        <StatBar label="信任度" value={state.trustLevel} colorClass="trust" />
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dash-border-light)', fontSize: 11, color: 'var(--dash-text-muted)' }}>
          今日完成 {state.tasksCompletedToday} 个任务 / 处理 {state.messagesHandledToday} 条消息
        </div>
      </div>
    </div>
  )
}

function ActivityFeed({ events }: { events: SSEEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div>
        <div className="dash-section-title">实时动态</div>
        <div style={{ fontSize: 12, color: 'var(--dash-text-muted)', padding: '10px 0' }}>
          等待事件...
        </div>
      </div>
    )
  }

  const getType = (e: SSEEvent) => {
    if (e.type === 'response') return 'complete'
    return 'progress'
  }

  const formatTime = (ts: string | undefined) => {
    if (!ts) return ''
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  return (
    <div>
      <div className="dash-section-title">实时动态</div>
      {events.slice(-15).reverse().map((e, i) => (
        <div className="dash-feed-item" key={i}>
          <div className={`dash-feed-dot ${getType(e)}`} />
          <div>
            <div>{e.content?.slice(0, 80)}{(e.content?.length || 0) > 80 ? '...' : ''}</div>
            <div className="dash-feed-time">{formatTime(e.timestamp)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
