/* 共享组件：Header + Logo Avatar + Sidebar Shell */
function JarvisAvatar({ size = 36 }) {
  return (
    <img
      src="jarvis-logo.png"
      alt="Jarvis"
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
    />
  );
}

function Header({ page, onNav, username, onSettingsOpen }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 24px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-elevated)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <JarvisAvatar size={32} />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Jarvis</span>
      </div>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {['chat', 'dashboard'].map(p => (
          <button key={p} onClick={() => onNav(p)} className="btn-text" style={{
            fontWeight: page === p ? 600 : 400,
            color: page === p ? 'var(--accent)' : 'var(--text-secondary)',
            background: page === p ? 'var(--accent-light)' : 'transparent',
            borderRadius: 'var(--radius-sm)', padding: '6px 12px', border: 'none', cursor: 'pointer',
            fontSize: 13, fontFamily: 'inherit',
          }}>
            {p === 'chat' ? '对话' : '仪表盘'}
          </button>
        ))}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{username}</span>
        <button onClick={onSettingsOpen} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', padding: 6, borderRadius: 6,
        }} title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit',
        }}>退出</button>
      </div>
    </header>
  );
}

Object.assign(window, { JarvisAvatar, Header });
