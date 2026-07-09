import { useState } from 'react'
import type { AuthUser } from '../../api/auth'
import { useSSE } from '../../api/hooks'
import { Header } from '../../components/Header'
import type { DashView } from './types'
import { OverviewPage } from './OverviewPage'
import { TasksPage } from './TasksPage'
import { TeamPage } from './TeamPage'
import './dashboard.css'

const NAV: Array<{ id: DashView; icon: string; label: string }> = [
  { id: 'overview', icon: '📊', label: '概览' },
  { id: 'tasks', icon: '📋', label: '任务' },
  { id: 'team', icon: '👥', label: '团队' },
]

export function DashboardPage({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [view, setView] = useState<DashView>('overview')
  const { connected } = useSSE('/events')

  return (
    <div className="dash-app">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="dash-body dash-body-nav">
        <nav className="dash-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`dash-nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span className="dash-nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="dash-content">
          {view === 'overview' && <OverviewPage />}
          {view === 'tasks' && <TasksPage />}
          {view === 'team' && <TeamPage />}
        </main>
      </div>
    </div>
  )
}
