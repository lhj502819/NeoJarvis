import { useState } from 'react'
import { usePolling } from '../../api/hooks'
import type { Task } from './types'
import { TaskDetail } from './components/TaskDetail'
import { TaskRunningRail } from './components/TaskRunningRail'

const STATUS_LABEL: Record<string, string> = {
  executing: '执行中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  created: '待启动',
  planning: '待启动',
}

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s
}

function calcProgress(task: Task): number {
  if (task.subtasks.length === 0) return 0
  const done = task.subtasks.filter(s => s.status === 'completed' || s.status === 'done').length
  return Math.round((done / task.subtasks.length) * 100)
}

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const progress = calcProgress(task)
  const showProgress = task.subtasks.length > 0 && task.status !== 'completed' && task.status !== 'failed'

  return (
    <div className="dash-card dash-clickable dash-task-card" onClick={onClick}>
      <div className="dash-task-row-main">
        <span className="dash-task-name">{task.name}</span>
        <span className={`dash-badge dash-badge-${task.status}`}>{statusLabel(task.status)}</span>
      </div>
      {task.description && (
        <div className="dash-task-desc">{task.description}</div>
      )}
      {showProgress && (
        <div className="dash-task-progress-wrap">
          <div className="dash-task-progress-bar">
            <div className="dash-task-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="dash-task-progress-pct">{progress}%</span>
        </div>
      )}
      <div className="dash-task-row-foot">
        <span>{task.subtasks.length} 个子任务</span>
        <button className="dash-task-detail-link">查看详情 →</button>
      </div>
    </div>
  )
}

type TabFilter = 'all' | 'running' | 'done' | 'failed'

function filterTasks(tasks: Task[], tab: TabFilter, search: string): Task[] {
  let filtered = tasks
  if (tab === 'running') filtered = filtered.filter(t => t.status === 'executing' || t.status === 'running')
  else if (tab === 'done') filtered = filtered.filter(t => t.status === 'completed')
  else if (tab === 'failed') filtered = filtered.filter(t => t.status === 'failed')
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter(t => t.name.toLowerCase().includes(q))
  }
  return filtered
}

export function TasksPage() {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 3000)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabFilter>('all')
  const [search, setSearch] = useState('')
  const tasks = tasksData?.tasks || []

  if (selectedTaskId) {
    return <TaskDetail taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} />
  }

  const runningCount = tasks.filter(t => t.status === 'executing' || t.status === 'running').length
  const doneCount = tasks.filter(t => t.status === 'completed').length
  const failedCount = tasks.filter(t => t.status === 'failed').length
  const filtered = filterTasks(tasks, tab, search)

  const tabs: Array<{ id: TabFilter; label: string; count: number }> = [
    { id: 'all', label: '全部', count: tasks.length },
    { id: 'running', label: '执行中', count: runningCount },
    { id: 'done', label: '已完成', count: doneCount },
    { id: 'failed', label: '失败', count: failedCount },
  ]

  return (
    <div className="tasks-page-layout">
      <div className="tasks-page-main">
        <div className="tasks-page-header">
          <h2 className="tasks-page-title">任务</h2>
          <p className="tasks-page-subtitle">追踪 Jarvis 和 Agent Team 的每一次执行</p>
        </div>

        <div className="dash-task-toolbar">
          <div className="dash-task-tabs">
            {tabs.map(t => (
              <button
                key={t.id}
                className={`dash-task-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label} {t.count > 0 && <span className="dash-task-tab-count">{t.count}</span>}
              </button>
            ))}
          </div>
          <input
            className="dash-search"
            placeholder="搜索任务"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="dash-empty-state">
            <div className="dash-empty-icon">📋</div>
            <div>{search ? '没有匹配的任务' : '暂无任务'}</div>
          </div>
        ) : (
          filtered.map(t => (
            <TaskCard key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />
          ))
        )}
      </div>
      <TaskRunningRail tasks={tasks} />
    </div>
  )
}
