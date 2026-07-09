import type { SSEEvent } from '../../../api/hooks'

export function ActivityFeed({ events }: { events: SSEEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div>
        <div className="dash-section-title">实时动态</div>
        <div style={{ fontSize: 12, color: 'var(--dash-text-muted)', padding: '10px 0' }}>
          等待事件...
        </div>
      </div>
    )
  }

  const getType = (e: SSEEvent) => {
    if (e.type === 'response') return 'complete'
    return 'progress'
  }

  const formatTime = (ts: string | undefined) => {
    if (!ts) return ''
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  return (
    <div>
      <div className="dash-section-title">实时动态</div>
      {events.slice(-15).reverse().map((e, i) => (
        <div className="dash-feed-item" key={i}>
          <div className={`dash-feed-dot ${getType(e)}`} />
          <div>
            <div>{e.content?.slice(0, 80)}{(e.content?.length || 0) > 80 ? '...' : ''}</div>
            <div className="dash-feed-time">{formatTime(e.timestamp)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
