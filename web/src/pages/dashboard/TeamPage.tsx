import { useState } from 'react'
import { usePolling } from '../../api/hooks'
import type { Recipe, AgentSession } from './types'
import { AgentProfile } from './components/AgentProfile'

export function TeamPage() {
  const recipes = usePolling<Recipe[]>('/api/recipes', 10000)
  const history = usePolling<AgentSession[]>('/api/history', 10000)
  const [selected, setSelected] = useState<Recipe | null>(null)

  if (selected) {
    return <AgentProfile recipe={selected} sessions={history || []} onBack={() => setSelected(null)} />
  }

  return (
    <div>
      <div className="dash-section-title">团队 ({recipes?.length ?? 0})</div>
      {recipes && recipes.length > 0 ? (
        <div className="dash-team-grid">
          {recipes.map(r => (
            <div className="dash-card dash-clickable" key={r.id} onClick={() => setSelected(r)}>
              <div className="dash-team-card-head">
                <span className="dash-agent-name">{r.name}</span>
                <span className="dash-badge">{r.createdBy === 'builtin' ? '内置' : '沉淀'}</span>
              </div>
              <div className="dash-agent-task">{r.description}</div>
              <div className="dash-profile-meta"><span>已执行 {r.usageCount} 次</span></div>
            </div>
          ))}
        </div>
      ) : <div className="dash-empty-hint">暂无团队成员</div>}
    </div>
  )
}
