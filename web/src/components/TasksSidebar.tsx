interface Task {
  id: string
  name: string
  status: string
  subtasks: Array<{
    id: string
    name: string
    status: string
    assignee: string
    progress?: string
  }>
}

interface Props {
  data: { summary: string; tasks: Task[] } | null
}

const statusStyles: Record<string, { color: string; icon: string }> = {
  executing: { color: 'var(--accent)', icon: '⚡' },
  running: { color: 'var(--accent)', icon: '●' },
  completed: { color: 'var(--green)', icon: '✓' },
  failed: { color: 'var(--red)', icon: '✕' },
  cancelled: { color: 'var(--text-muted)', icon: '⊘' },
  planning: { color: 'var(--yellow)', icon: '◐' },
  pending: { color: 'var(--text-muted)', icon: '○' },
}

export function TasksSidebar({ data }: Props) {
  if (!data) return null

  const activeTasks = data.tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
  const recentDone = data.tasks.filter(t => t.status === 'completed').slice(-3)

  const sectionTitle = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={sectionTitle}>任务</h3>

      {activeTasks.length === 0 && recentDone.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无任务</p>
      )}

      {activeTasks.map(task => {
        const s = statusStyles[task.status] || statusStyles.pending
        return (
          <div
            key={task.id}
            className="j-card"
            style={{ padding: '10px 12px', marginBottom: 6 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: s.color, fontSize: 12 }}>{s.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{task.name}</span>
            </div>
            {task.subtasks.length > 0 && (
              <div style={{ marginTop: 6, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {task.subtasks.map(st => {
                  const ss = statusStyles[st.status] || statusStyles.pending
                  return (
                    <div key={st.id} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: ss.color }}>{ss.icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {recentDone.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>最近完成</p>
          {recentDone.map(t => (
            <div key={t.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--green)' }}>✓</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
