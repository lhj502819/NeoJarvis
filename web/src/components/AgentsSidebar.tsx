import { postJSON } from '../api/client'
import { AgentAvatar } from './AgentAvatar'

interface Agent {
  subtaskId: string
  name: string
  recipeId: string
  description: string
  startedAt: number
}

interface Recipe {
  id: string
  name: string
  description: string
  usageCount: number
  context: Record<string, unknown>
  avatar?: string
}

interface Props {
  running: Agent[] | null
  recipes: Recipe[] | null
}

export function AgentsSidebar({ running, recipes }: Props) {
  const handleInterrupt = async (subtaskId: string) => {
    await postJSON('/api/agent/interrupt', { subtaskId })
  }

  const sectionTitle = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10,
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={sectionTitle}>团队</h3>

      {running && running.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>运行中</p>
          {running.map(agent => (
            <div key={agent.subtaskId} className="j-card" style={{ padding: '10px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{agent.name}</span>
                <button
                  onClick={() => handleInterrupt(agent.subtaskId)}
                  style={{
                    fontSize: 11, color: 'var(--red)', background: 'transparent',
                    border: 'none', cursor: 'pointer', padding: '2px 6px',
                    borderRadius: 'var(--radius-xs)', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  打断
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.description}
              </p>
            </div>
          ))}
        </div>
      )}

      {recipes && recipes.length > 0 ? (
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>小弟 ({recipes.length})</p>
          {recipes.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
              <AgentAvatar seed={r.id} emoji={r.avatar} fallback={r.name} size={22} radius={11} />
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ color: 'var(--text)' }}>{r.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>×{r.usageCount}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无小弟，执行任务后会自动沉淀</p>
      )}
    </div>
  )
}
