import { useState, useEffect, useRef } from 'react'
import { useChat, useSSE, parseSubtaskEvent } from '../api/hooks'
import { checkAuth, logout, type AuthUser } from '../api/auth'
import { ChatPanel, type Artifact } from './ChatPanel'
import { MonitorPanel } from './MonitorPanel'
import { ExecutionModal } from './ExecutionModal'
import { LoginPage } from './LoginPage'
import { TasksPage } from '../pages/dashboard/TasksPage'
import { TeamPage } from '../pages/dashboard/TeamPage'
import { ArtifactsPage } from '../pages/dashboard/ArtifactsPage'
import { SkillsPage } from '../pages/dashboard/SkillsPage'
import { McpPage } from '../pages/dashboard/McpPage'
import '../pages/dashboard/dashboard.css'
import './Layout.css'

type View = 'chat' | 'tasks' | 'team' | 'artifacts' | 'skills' | 'mcp'

const NAV_ITEMS: Array<{ id: View; icon: string; label: string }> = [
  { id: 'chat', icon: '💬', label: '对话' },
  { id: 'tasks', icon: '📋', label: '任务' },
  { id: 'team', icon: '👥', label: '团队' },
  { id: 'artifacts', icon: '📦', label: '制品库' },
  { id: 'skills', icon: '✦', label: '技能' },
  { id: 'mcp', icon: '🔌', label: 'MCP' },
]

export default function Layout() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [view, setView] = useState<View>('chat')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => { checkAuth().then(u => setUser(u)) }, [])

  if (user === undefined) {
    return <div className="layout-loading">加载中...</div>
  }
  if (!user) {
    return <LoginPage onLogin={() => checkAuth().then(u => setUser(u))} />
  }

  return (
    <div className="layout">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-logo">
          <img src="/jarvis-logo.png" alt="Jarvis" className="sidebar-logo-img" />
          <div className="sidebar-logo-meta">
            <span className="sidebar-logo-text">JARVIS</span>
            <span className="sidebar-logo-sub">SYSTEM ONLINE</span>
          </div>
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? '展开' : '收起'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {collapsed
                ? <path d="M9 18l6-6-6-6" />
                : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-item${view === item.id ? ' active' : ''}`}
              onClick={() => setView(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{(user.displayName || user.username)[0].toUpperCase()}</div>
            <span className="sidebar-username">{user.displayName || user.username}</span>
          </div>
          <button className="sidebar-logout" onClick={() => logout().then(() => { setUser(null); window.location.hash = '#/landing' })} title="退出">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </aside>
      <MainArea view={view} user={user} />
    </div>
  )
}

function MainArea({ view, user }: { view: View; user: AuthUser }) {
  const { messages, isLoading, send, applyLiveEvent, clear } = useChat()
  const { connected, events } = useSSE('/events')
  const lastSeqRef = useRef(0)
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)
  const [pinnedArtifact, setPinnedArtifact] = useState<Artifact | null>(null)

  useEffect(() => {
    for (const evt of events) {
      const seq = evt._seq ?? 0
      if (seq <= lastSeqRef.current) continue
      lastSeqRef.current = seq

      if (evt.type === 'artifact_pinned') {
        try {
          const data = JSON.parse(evt.content)
          if (data.pinned) setPinnedArtifact({ type: data.type, title: data.title, content: data.content, language: data.language })
          else setPinnedArtifact(null)
        } catch {}
        continue
      }
      if (evt.type === 'artifact_updated') {
        try {
          const data = JSON.parse(evt.content)
          setPinnedArtifact(prev => prev ? { ...prev, content: data.content, title: data.title } : null)
        } catch {}
        continue
      }

      applyLiveEvent(evt)
    }
  }, [events, applyLiveEvent])

  return (
    <div className="main-area">
      <div className="main-content">
        {view === 'chat' && (
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSend={send}
            onClear={clear}
            pinnedArtifact={pinnedArtifact}
            onUnpin={() => setPinnedArtifact(null)}
          />
        )}
        {view === 'tasks' && <div className="main-page-wrap"><TasksPage /></div>}
        {view === 'team' && <div className="main-page-wrap"><TeamPage /></div>}
        {view === 'artifacts' && <div className="main-page-wrap"><ArtifactsPage /></div>}
        {view === 'skills' && <div className="main-page-wrap"><SkillsPage /></div>}
        {view === 'mcp' && <div className="main-page-wrap"><McpPage /></div>}
      </div>
      {view !== 'tasks' && <MonitorPanel onOpen={(taskId, subtaskId) => setModal({ taskId, subtaskId })} />}
      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}
