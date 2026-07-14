import { usePolling } from '../../../api/hooks'
import type { Task, RunningAgent } from '../types'

function statusLabel(status: string): string {
  if (status === 'executing' || status === 'running') return '执行中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'created' || status === 'planning') return '待启动'
  return status
}

function isRunning(status: string): boolean {
  return status === 'executing' || status === 'running'
}

function isCompletedToday(task: Task): boolean {
  if (task.status !== 'completed') return false
  const updated = new Date(task.updatedAt)
  return updated.toDateString() === new Date().toDateString()
}

export function TaskRunningRail({ tasks }: { tasks: Task[] }) {
  const agents = usePolling<RunningAgent[]>('/api/agents', 5000) || []

  const runningCount = tasks.filter(t => isRunning(t.status)).length
  const todayDone = tasks.filter(t => isCompletedToday(t)).length

  return (
    <div className="task-rail">
      <div className="task-rail-title">运行状态</div>

      <div className="task-rail-stats">
        <div className="task-rail-stat">
          <span className="task-rail-stat-value task-rail-stat-purple">{agents.length}</span>
          <span className="task-rail-stat-label">活跃 Agent</span>
        </div>
        <div className="task-rail-stat">
          <span className="task-rail-stat-value task-rail-stat-cyan">{runningCount}</span>
          <span className="task-rail-stat-label">执行中</span>
        </div>
        <div className="task-rail-stat">
          <span className="task-rail-stat-value task-rail-stat-teal">{todayDone}</span>
          <span className="task-rail-stat-label">今日完成</span>
        </div>
      </div>

      <div className="task-rail-section-title">Agent 团队</div>
      {agents.length === 0 ? (
        <div className="dash-empty-hint">暂无活跃 Agent</div>
      ) : (
        <div className="task-rail-agent-list">
          {agents.map((agent, idx) => (
            <div key={agent.subtaskId || idx} className="task-rail-agent-item">
              <div className="task-rail-agent-info">
                <span className="task-rail-agent-name">{agent.name}</span>
                <span className="task-rail-agent-desc">{agent.description || statusLabel('running')}</span>
              </div>
              <span className="task-rail-online-dot" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
