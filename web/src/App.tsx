import { useEffect, useState, useRef } from 'react'
import { Header } from './components/Header'
import { ChatPanel } from './components/ChatPanel'
import { LoginPage } from './components/LoginPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { LandingPage } from './pages/LandingPage'
import { useChat, useSSE } from './api/hooks'
import { checkAuth, logout, type AuthUser } from './api/auth'
import { MonitorPanel } from './components/MonitorPanel'
import { ExecutionModal } from './components/ExecutionModal'

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
    window.location.hash = '#/landing'
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
  const lastSeqRef = useRef(0)
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)

  useEffect(() => {
    for (const evt of events) {
      const seq = evt._seq ?? 0
      if (seq <= lastSeqRef.current) continue
      lastSeqRef.current = seq
      applyLiveEvent(evt)
    }
  }, [events, applyLiveEvent])

  return (
    <div className="h-screen flex flex-col">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden min-w-0">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={send} />
        </div>
        <MonitorPanel onOpen={(taskId, subtaskId) => setModal({ taskId, subtaskId })} />
      </div>
      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}

export default App
