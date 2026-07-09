import { useState } from 'react'
import { usePolling } from '../../api/hooks'
import type { Task } from './types'

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div className="dash-card dash-clickable dash-task-row" onClick={onClick}>
      <div className="dash-task-row-main">
        <span className="dash-task-name">{task.name}</span>
        <span className={`dash-badge dash-badge-${task.status}`}>{task.status}</span>
      </div>
      <div className="dash-task-desc">{task.description}</div>
      <div className="dash-task-row-foot">
        <span>{task.subtasks.length} 子任务</span>
        <span className="dash-task-id-mono">{task.id}</span>
      </div>
    </div>
  )
}

export function TasksPage() {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 3000)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const tasks = tasksData?.tasks || []

  if (selectedTaskId) {
    // Task 9 会替换成 <TaskDetail taskId={selectedTaskId} onBack={...} />
    return (
      <div>
        <button className="dash-back-btn" onClick={() => setSelectedTaskId(null)}>← 返回任务</button>
        <div className="dash-section-title">任务详情（待 Task 9 实现）: {selectedTaskId}</div>
      </div>
    )
  }

  const active = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const done = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <div>
      {active.length > 0 && (
        <>
          <div className="dash-section-title">进行中 ({active.length})</div>
          {active.map(t => <TaskRow key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />)}
        </>
      )}
      <div className="dash-section-title" style={{ marginTop: active.length ? 20 : 0 }}>历史任务 ({done.length})</div>
      {done.length > 0
        ? done.slice(0, 30).map(t => <TaskRow key={t.id} task={t} onClick={() => setSelectedTaskId(t.id)} />)
        : <div className="dash-empty-hint">暂无</div>}
    </div>
  )
}
