import type { JarvisState } from '../types'

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

export function JarvisStateCard({ state }: { state: JarvisState | null }) {
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
