import { useState, useEffect, useRef, type ReactNode } from 'react'
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
import { ConfigPage } from '../pages/dashboard/ConfigPage'
import { RunningPage } from '../pages/dashboard/RunningPage'
import { CredentialsModal } from './CredentialsModal'
import '../pages/dashboard/dashboard.css'
import './Layout.css'

type View = 'chat' | 'tasks' | 'team' | 'artifacts' | 'skills' | 'mcp' | 'config' | 'running'

/* ── Codex 式 16px 线性图标(stroke 跟随 currentColor)── */
const Icon = {
  newTask: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
      <path d="M18 1.5l3.5 3.5L12 14.5H8.5V11z" />
    </svg>
  ),
  search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
    </svg>
  ),
  plugin: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="18" r="2.2" />
    </svg>
  ),
  clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2.5" />
    </svg>
  ),
  folder: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2.5 3H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  gear: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  sun: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
  ),
  moon: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
  ),
  logout: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  ),
  settings: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
}

/* 顶部动作区(Codex:新任务/搜索/插件/定时任务) */
const PRIMARY_ACTIONS: Array<{ view: View; label: string; icon: ReactNode; newTask?: boolean; noActive?: boolean }> = [
  { view: 'chat', label: '新任务', icon: <Icon.newTask />, newTask: true },
  { view: 'tasks', label: '搜索', icon: <Icon.search />, noActive: true },
  { view: 'mcp', label: '插件', icon: <Icon.plugin /> },
  { view: 'tasks', label: '定时任务', icon: <Icon.clock /> },
]
/* 工作台分区(原六个视图的去重收纳) */
const WORKBENCH_ITEMS: Array<{ view: View; label: string; icon: ReactNode }> = [
  { view: 'team', label: '团队', icon: <Icon.folder /> },
  { view: 'artifacts', label: '制品库', icon: <Icon.folder /> },
  { view: 'skills', label: '技能', icon: <Icon.folder /> },
  { view: 'config', label: '配置', icon: <Icon.gear /> },
  { view: 'running', label: '运行', icon: <Icon.clock /> },
]

export default function Layout() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [view, setView] = useState<View>('chat')
  const [collapsed, setCollapsed] = useState(false)
  // 主题:浅(默认,Codex 风)↔ 深。data-theme 挂 <html>,localStorage 记忆。
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')
  // 「新任务」信号:触发 chat 清空(计数器,连点也生效)
  const [newTaskSignal, setNewTaskSignal] = useState(0)
  // 头像弹出菜单 + 设置弹窗
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点菜单外部关闭
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
    localStorage.setItem('jarvis-theme', next)
  }

  const handleNewTask = () => {
    setView('chat')
    setNewTaskSignal(s => s + 1)
  }

  useEffect(() => { checkAuth().then(u => setUser(u)) }, [])

  if (user === undefined) {
    return <div className="layout-loading">加载中...</div>
  }
  if (!user) {
    return <LoginPage onLogin={() => checkAuth().then(u => setUser(u))} />
  }

  const navItem = (item: { view: View; label: string; icon: ReactNode; newTask?: boolean; noActive?: boolean }) => {
    const active = !item.noActive && !item.newTask && view === item.view
    return (
      <button
        key={item.label}
        className={`sidebar-nav-item${active ? ' active' : ''}`}
        onClick={() => (item.newTask ? handleNewTask() : setView(item.view))}
        title={collapsed ? item.label : undefined}
      >
        <span className="sidebar-nav-icon">{item.icon}</span>
        <span className="sidebar-nav-label">{item.label}</span>
      </button>
    )
  }

  return (
    <div className="layout">
      {/* Electron 桌面拖拽区:让 macOS 识别顶部为标题栏,双击触发系统 zoom(最大化/还原)。
          浏览器忽略 -webkit-app-region 属性,不影响 web 端。 */}
      <div className="electron-titlebar-drag" />
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-top">
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? '展开' : '收起'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              {collapsed
                ? <path d="M9 18l6-6-6-6" />
                : <><rect x="3" y="4" width="18" height="16" rx="3" /><line x1="9.5" y1="4" x2="9.5" y2="20" /></>}
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {PRIMARY_ACTIONS.map(navItem)}
          <div className="sidebar-section">
            <span className="sidebar-section-label">工作台</span>
          </div>
          {WORKBENCH_ITEMS.map(item => navItem({ ...item }))}
        </nav>
        <div className="sidebar-footer" ref={menuRef}>
          <button className="sidebar-user sidebar-user-btn" onClick={() => setMenuOpen(o => !o)} title="账户与设置">
            <div className="sidebar-avatar">{(user.displayName || user.username)[0].toUpperCase()}</div>
            <span className="sidebar-username">{user.displayName || user.username}</span>
          </button>
          <button className="sidebar-gear-btn" onClick={() => setMenuOpen(o => !o)} title="设置">
            <Icon.gear />
          </button>

          {menuOpen && (
            <div className="sidebar-menu">
              <button className="sidebar-menu-item" onClick={() => { setMenuOpen(false); setSettingsOpen(true) }}>
                <Icon.settings />
                设置
              </button>
              <button className="sidebar-menu-item" onClick={() => { toggleTheme() }}>
                {theme === 'dark' ? <Icon.sun /> : <Icon.moon />}
                外观:{theme === 'dark' ? '深色' : '浅色'}
              </button>
              <div className="sidebar-menu-sep"></div>
              <button className="sidebar-menu-item sidebar-menu-danger" onClick={() => { setMenuOpen(false); logout().then(() => { setUser(null); window.location.hash = '#/landing' }) }}>
                <Icon.logout />
                退出登录
              </button>
            </div>
          )}
        </div>
      </aside>
      <MainArea view={view} user={user} newTaskSignal={newTaskSignal} />
      <CredentialsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function MainArea({ view, user, newTaskSignal }: { view: View; user: AuthUser; newTaskSignal: number }) {
  const { messages, isLoading, send, applyLiveEvent, clear } = useChat()
  const { events } = useSSE('/events')
  const lastSeqRef = useRef(0)
  const [modal, setModal] = useState<{ taskId: string; subtaskId: string } | null>(null)
  const [pinnedArtifact, setPinnedArtifact] = useState<Artifact | null>(null)
  // 执行监控抽屉(Codex 式抽屉;有小弟跑起来自动唤起,手动关闭后同任务不反复弹)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const knownRunningRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (newTaskSignal > 0) clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTaskSignal])

  useEffect(() => {
    for (const evt of events) {
      const seq = evt._seq ?? 0
      if (seq <= lastSeqRef.current) continue
      lastSeqRef.current = seq

      // 新子任务进入 running → 自动展开监控抽屉(京ME/后台派活也生效)
      if (evt.type === 'subtask') {
        const p = parseSubtaskEvent(evt.content)
        if (p?.status === 'running' && !knownRunningRef.current.has(p.subtaskId)) {
          knownRunningRef.current.add(p.subtaskId)
          setMonitorOpen(true)
        }
      }

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
            userInitial={(user.displayName || user.username || 'U')[0]}
            monitorOpen={monitorOpen}
            onToggleMonitor={() => setMonitorOpen(o => !o)}
          />
        )}
        {view === 'tasks' && <div className="main-page-wrap"><TasksPage /></div>}
        {view === 'team' && <div className="main-page-wrap"><TeamPage /></div>}
        {view === 'artifacts' && <div className="main-page-wrap"><ArtifactsPage /></div>}
        {view === 'skills' && <div className="main-page-wrap"><SkillsPage /></div>}
        {view === 'mcp' && <div className="main-page-wrap"><McpPage /></div>}
        {view === 'config' && <div className="main-page-wrap"><ConfigPage /></div>}
        {view === 'running' && <div className="main-page-wrap"><RunningPage /></div>}
      </div>
      {view !== 'tasks' && monitorOpen && <MonitorPanel onOpen={(taskId, subtaskId) => setModal({ taskId, subtaskId })} />}
      {modal && <ExecutionModal taskId={modal.taskId} subtaskId={modal.subtaskId} onClose={() => setModal(null)} />}
    </div>
  )
}
