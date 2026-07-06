function StatBar({ label, value, max = 100, colorClass }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-bar">
        <div className={`stat-fill ${colorClass}`} style={{ width: `${pct}%` }}></div>
      </div>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function JarvisStateCard({ state }) {
  if (!state) return null;

  return (
    <div>
      <div className="section-title">Jarvis 状态</div>
      <div className="card state-card">
        <StatBar label="心情" value={state.mood} colorClass="mood" />
        <StatBar label="精力" value={state.energy} colorClass="energy" />
        <StatBar label="把握度" value={state.confidence} colorClass="confidence" />
        <StatBar label="了解度" value={state.familiarity} colorClass="familiarity" />
        <StatBar label="信任度" value={state.trustLevel} colorClass="trust" />
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)' }}>
          今日完成 {state.tasksCompletedToday} 个任务 / 处理 {state.messagesHandledToday} 条消息
        </div>
      </div>
    </div>
  );
}

function ActivityFeed({ events }) {
  if (!events || events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>
        等待事件...
      </div>
    );
  }

  const getType = (e) => {
    if (e.type === 'progress') return 'progress';
    if (e.type === 'response') return 'complete';
    return 'progress';
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  };

  return (
    <div>
      <div className="section-title">实时动态</div>
      {events.slice(-15).reverse().map((e, i) => (
        <div className="feed-item" key={i}>
          <div className={`feed-dot ${getType(e)}`}></div>
          <div>
            <div>{e.content?.slice(0, 80)}{e.content?.length > 80 ? '...' : ''}</div>
            <div className="feed-time">{formatTime(e._ts)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { JarvisStateCard, ActivityFeed });
