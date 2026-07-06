interface Props {
  connected: boolean
  username?: string
  onLogout?: () => void
}

export function Header({ connected, username, onLogout }: Props) {
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
        {onLogout && (
          <button onClick={onLogout} className="text-xs text-[#a0a0a0] hover:text-[#e94560] transition-colors">退出</button>
        )}
        <div className="flex items-center gap-2 text-sm text-[#a0a0a0]">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>
    </header>
  )
}
