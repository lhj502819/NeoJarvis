import { useState, useEffect } from 'react'
import { CredentialsModal } from './CredentialsModal'

interface Props {
  connected: boolean
  username?: string
  onLogout?: () => void
}

// 判断当前路由，用来高亮导航
function useCurrentRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash === '#/dashboard' ? 'dashboard' : 'chat'
}

export function Header({ connected, username, onLogout }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const page = useCurrentRoute()

  const navBtn = (target: 'chat' | 'dashboard', label: string, href: string) => (
    <a
      href={href}
      style={{
        fontSize: 13,
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        fontWeight: page === target ? 600 : 400,
        color: page === target ? 'var(--accent)' : 'var(--text-secondary)',
        background: page === target ? 'var(--accent-light)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </a>
  )

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          src="/jarvis-logo.png"
          alt="Jarvis"
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
        />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Jarvis</span>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {navBtn('chat', '对话', '#/')}
        {navBtn('dashboard', '仪表盘', '#/dashboard')}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--green)' : 'var(--red)' }} />
          {connected ? '已连接' : '未连接'}
        </div>
        {username && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{username}</span>}
        <button
          onClick={() => setSettingsOpen(true)}
          title="API 凭证设置"
          aria-label="设置"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 6, borderRadius: 6 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit' }}
          >
            退出
          </button>
        )}
      </div>

      <CredentialsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  )
}
