import { useEffect, useState, useRef } from 'react'
import { Header } from './components/Header'
import { ChatPanel } from './components/ChatPanel'
import { LoginPage } from './components/LoginPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { LandingPage } from './pages/LandingPage'
import { useChat, useSSE } from './api/hooks'
import { checkAuth, logout, type AuthUser } from './api/auth'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash
}

function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const route = useHashRoute()

  useEffect(() => {
    checkAuth().then(u => setUser(u))
  }, [])

  const handleLogout = async () => {
    await logout()
    setUser(null)
  }

  if (user === undefined) {
    return <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>加载中...</div>
  }

  if (route === '#/landing') {
    return <LandingPage />
  }

  if (!user) {
    return <LoginPage onLogin={() => checkAuth().then(u => setUser(u))} />
  }

  if (route === '#/dashboard') {
    return <DashboardPage user={user} onLogout={handleLogout} />
  }

  return <ChatView user={user} onLogout={handleLogout} />
}

function ChatView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { messages, isLoading, send, applyLiveEvent } = useChat()
  const { connected, events } = useSSE('/events')
  const processedRef = useRef(0)

  useEffect(() => {
    // 只处理新增的 /events 事件(events 是累积数组),交给 applyLiveEvent
    // 驱动刷新恢复后的进行中气泡;发起方会在 applyLiveEvent 内部忽略。
    for (let i = processedRef.current; i < events.length; i++) {
      applyLiveEvent(events[i])
    }
    processedRef.current = events.length
  }, [events, applyLiveEvent])

  return (
    <div className="h-screen flex flex-col">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="flex-1 overflow-hidden">
        <ChatPanel messages={messages} isLoading={isLoading} onSend={send} />
      </div>
    </div>
  )
}

export default App
