interface JarvisState {
  mood: number
  energy: number
  confidence: number
  tasksCompletedToday: number
  messagesHandledToday: number
  familiarity: number
  trustLevel: number
}

interface Props {
  state: JarvisState | null
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ width: '100%', height: 4, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 2, background: color, width: `${value}%`, transition: 'width 0.3s' }} />
    </div>
  )
}

export function StatusCard({ state }: Props) {
  if (!state) return null

  const sectionTitle = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10,
  }

  const rowLabel = { fontSize: 11, color: 'var(--text-muted)' }
  const rowValue = { fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' as const }

  const items = [
    { label: '精力', value: state.energy, color: 'var(--green)' },
    { label: '心情', value: state.mood, color: 'var(--accent)' },
    { label: '信任度', value: state.trustLevel, color: 'var(--yellow)' },
  ]

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={sectionTitle}>Jarvis 状态</h3>
      <div className="j-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(it => (
          <div key={it.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={rowLabel}>{it.label}</span>
              <span style={rowValue}>{it.value}</span>
            </div>
            <Bar value={it.value} color={it.color} />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
          <span style={rowLabel}>今日完成</span>
          <span style={rowValue}>{state.tasksCompletedToday} 任务 / {state.messagesHandledToday} 消息</span>
        </div>
      </div>
    </div>
  )
}
