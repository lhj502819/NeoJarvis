import { usePolling, useSSE } from '../../api/hooks'
import type { Task, RunningAgent, Recipe, JarvisState } from './types'
import { StatCard } from './components/StatCard'
import { JarvisStateCard } from './components/JarvisState'
import { ActivityFeed } from './components/ActivityFeed'

export function OverviewPage() {
  const tasksData = usePolling<{ summary: string; tasks: Task[] }>('/tasks', 3000)
  const agentsData = usePolling<RunningAgent[]>('/api/agents', 3000)
  const recipesData = usePolling<Recipe[]>('/api/recipes', 10000)
  const stateData = usePolling<JarvisState>('/api/state', 3000)
  const { events } = useSSE('/events')

  const tasks = tasksData?.tasks || []
  const running = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const doneToday = stateData?.tasksCompletedToday ?? 0

  return (
    <div>
      <div className="dash-section-title">概览</div>
      <div className="dash-stat-row-cards">
        <StatCard label="进行中任务" value={running.length} />
        <StatCard label="今日完成" value={doneToday} />
        <StatCard label="团队成员" value={recipesData?.length ?? 0} />
        <StatCard label="在跑小弟" value={agentsData?.length ?? 0} />
      </div>
      <div className="dash-overview-grid">
        <div><JarvisStateCard state={stateData ?? null} /></div>
        <div><ActivityFeed events={events} /></div>
      </div>
    </div>
  )
}
