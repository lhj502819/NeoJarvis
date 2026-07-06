import { useState } from 'react'
import { CredentialsModal } from './CredentialsModal'

interface Props {
  connected: boolean
  username?: string
  onLogout?: () => void
}

export function Header({ connected, username, onLogout }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2a4a] bg-[#12122a]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#e94560] to-[#f06292] flex items-center justify-center text-white font-bold text-sm">
          J
        </div>
        <span className="text-lg font-semibold text-white">Jarvis</span>
      </div>
      <div className="flex items-center gap-4">
        <a href="#/dashboard" className="text-sm text-[#7c7cff] hover:text-[#9e9eff] transition-colors">Dashboard</a>
        {username && (
          <span className="text-sm text-[#a0a0a0]">{username}</span>
        )}
        <button onClick={() => setSettingsOpen(true)} title="API 凭证设置" className="text-[#a0a0a0] hover:text-white transition-colors" aria-label="设置">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {onLogout && (
          <button onClick={onLogout} className="text-xs text-[#a0a0a0] hover:text-[#e94560] transition-colors">退出</button>
        )}
        <div className="flex items-center gap-2 text-sm text-[#a0a0a0]">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
      <CredentialsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  )
}
