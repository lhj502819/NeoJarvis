import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { ChatPanel } from './components/ChatPanel'
import { TasksSidebar } from './components/TasksSidebar'
import { AgentsSidebar } from './components/AgentsSidebar'
import { StatusCard } from './components/StatusCard'
import { LoginPage } from './components/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { useChat, usePolling, useSSE } from './api/hooks'
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

  if (!user) {
    return <LoginPage onLogin={() => checkAuth().then(u => setUser(u))} />
  }

  if (route === '#/dashboard') {
    return <DashboardPage user={user} onLogout={handleLogout} />
  }

  return <ChatView user={user} onLogout={handleLogout} />
}

function ChatView({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { messages, isLoading, send, addSystemMessage } = useChat()
  const { connected, events } = useSSE('/events')
  const tasksData = usePolling<{ summary: string; tasks: any[] }>('/tasks', 2000)
  const agentsData = usePolling<any[]>('/api/agents', 2000)
  const recipesData = usePolling<any[]>('/api/recipes', 10000)
  const stateData = usePolling<any>('/api/state', 5000)

  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    if (latest.type === 'response') {
      addSystemMessage(latest.content)
    }
  }, [events, addSystemMessage])

  return (
    <div className="h-screen flex flex-col">
      <Header connected={connected} username={user.displayName || user.username} onLogout={onLogout} />
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col min-w-0">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={send} />
        </main>

        <aside
          className="w-72 overflow-y-auto p-4 hidden lg:block"
          style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg)' }}
        >
          <TasksSidebar data={tasksData} />
          <AgentsSidebar running={agentsData} recipes={recipesData} />
          <StatusCard state={stateData} />
        </aside>
      </div>
    </div>
  )
}

export default App
