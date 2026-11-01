import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { MessageBubble } from './MessageBubble'
import { ArtifactPanel, type Artifact } from './ArtifactPanel'
export type { Artifact }
import { fetchArtifact, type ChatImagePayload } from '../api/client'
import type { Message, MessageArtifact } from '../api/hooks'

/** 顶栏右侧线性图标 */
const TopIcon = {
  eraser: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20H8.5L3.5 15a2 2 0 0 1 0-2.8l8.8-8.8a2 2 0 0 1 2.8 0l5.2 5.2a2 2 0 0 1 0 2.8L14 18" />
      <path d="M7 10l7 7" />
    </svg>
  ),
  panel: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="3" /><line x1="14.5" y1="4" x2="14.5" y2="20" />
    </svg>
  ),
  plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  expand: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  ),
  up: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  down: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  ),
}

const MODEL_LABEL = 'DeepSeek-V4.1-Flash-A'

/* 回复后的快捷追问 chips(Codex「接下来」) */
const SUGGESTIONS = ['继续', '展开说说', '出个落地计划']

/**
 * 输入框(自持 input/pending 状态)。
 * 单独 memo:打字触发的 setState 只重渲染这里,不波及消息列表 —— 修「打字卡」的核心。
 * onSend 来自 useChat 的 send(useCallback 稳定引用),故 memo 生效。
 */
const Composer = memo(function Composer({ onSend }: { onSend: (text: string, images?: ChatImagePayload[]) => void }) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<ChatImagePayload[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const addFiles = async (files: FileList | File[]) => {
    const payloads = (await Promise.all(Array.from(files).map(fileToPayload))).filter((p): p is ChatImagePayload => !!p)
    if (payloads.length) setPending(prev => [...prev, ...payloads])
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }

  const autoGrow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text && pending.length === 0) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    const images = pending
    setPending([])
    onSend(text, images.length ? images : undefined)
  }

  return (
    <form onSubmit={e => handleSubmit(e)} style={{ padding: '8px 24px 20px', flexShrink: 0 }} className="composer-wrap">
      <div className="composer-card">
        {/* 待发图片缩略图 */}
        {pending.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 18px 0' }}>
            {pending.map((im, i) => (
              <div key={i} style={{ position: 'relative', width: 52, height: 52 }}>
                <img
                  src={`data:${im.mediaType};base64,${im.data}`}
                  style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                />
                <button
                  type="button"
                  onClick={() => setPending(prev => prev.filter((_, j) => j !== i))}
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                    border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer',
                    fontSize: 11, lineHeight: '18px', padding: 0, textAlign: 'center',
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          className="composer-input"
          rows={1}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow() }}
          onPaste={handlePaste}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
          }}
          placeholder="随心输入"
        />
        <div className="composer-toolbar">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
          <button type="button" className="composer-icon-btn" onClick={() => fileRef.current?.click()} title="添加图片">
            <TopIcon.plus />
          </button>
          <span className="composer-model" title="当前模型(由服务端 .env 配置)">{MODEL_LABEL}</span>
          <button
            type="submit"
            className="composer-send"
            disabled={!input.trim() && pending.length === 0}
            title="发送"
          >
            <TopIcon.up />
          </button>
        </div>
      </div>
    </form>
  )
})

function ResizeHandle({ baseWidth, onResize, onDragStart, onDragEnd }: { baseWidth: number; onResize: (newWidth: number) => void; onDragStart: () => void; onDragEnd: () => void }) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const base = baseWidth
    const maxWidth = window.innerWidth - 200
    onDragStart()
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      onResize(Math.max(280, Math.min(maxWidth, base + delta)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onDragEnd()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  return <div className="chat-resize-handle" onMouseDown={onMouseDown} />
}

interface Props {
  messages: Message[]
  isLoading: boolean
  onSend: (text: string, images?: ChatImagePayload[]) => void
  onClear?: () => void
  pinnedArtifact?: Artifact | null
  onUnpin?: () => void
  userInitial?: string
  monitorOpen?: boolean
  onToggleMonitor?: () => void
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024  // 单张 5MB

function fileToPayload(file: File): Promise<ChatImagePayload | null> {
  return new Promise(resolve => {
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_BYTES) { resolve(null); return }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? { mediaType: file.type, data: result.slice(comma + 1) } : null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** Codex 式顶栏:会话标题 + 状态点;右侧 = 清空 / 监控开关 */
function ChatTopbar({ mood, onClear, hasMessages, monitorOpen, onToggleMonitor }: {
  mood: 'thinking' | 'happy' | 'idle'
  onClear?: () => void
  hasMessages: boolean
  monitorOpen: boolean
  onToggleMonitor?: () => void
}) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-title">
        <span>{hasMessages ? '对话' : '新对话'}</span>
        <span className="chat-status-dot" data-mood={mood} />
      </div>
      <div className="chat-topbar-actions">
        {hasMessages && onClear && (
          <button className="chat-topbar-btn" onClick={onClear} title="清空记忆" type="button">
            <TopIcon.eraser />
          </button>
        )}
        {onToggleMonitor && (
          <button className="chat-topbar-btn" onClick={onToggleMonitor} data-active={monitorOpen} title="执行监控" type="button">
            <TopIcon.panel />
          </button>
        )}
      </div>
    </div>
  )
}

export function ChatPanel({ messages, isLoading, onSend, onClear, pinnedArtifact, onUnpin, monitorOpen, onToggleMonitor }: Props) {
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [artifactWidth, setArtifactWidth] = useState(440)
  const [artifactFullscreen, setArtifactFullscreen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const initialScrollDone = useRef(false)

  useEffect(() => {
    if (!messages.length) return
    if (!initialScrollDone.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      initialScrollDone.current = true
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Raw signal straight from the message stream.
  const rawThinking = messages.some(m => m.status === 'thinking' || m.status === 'streaming')
  const hasMessages = messages.length > 0

  // Hold the "thinking" orb for at least a full beat. A fast reply otherwise
  // flips it back to "happy" before the animation is even visible — which is
  // exactly the "一闪而过" flicker Sir saw.
  const [showThinking, setShowThinking] = useState(false)
  const clearAtRef = useRef(0)
  useEffect(() => {
    const MIN_THINKING_MS = 1500
    let timer: number | undefined
    if (rawThinking) {
      setShowThinking(true)
      clearAtRef.current = Date.now() + MIN_THINKING_MS
    } else if (showThinking) {
      const remain = Math.max(0, clearAtRef.current - Date.now())
      timer = window.setTimeout(() => setShowThinking(false), remain)
    }
    return () => { if (timer) clearTimeout(timer) }
  }, [rawThinking, showThinking])

  const mood: 'thinking' | 'happy' | 'idle' = showThinking ? 'thinking' : hasMessages ? 'happy' : 'idle'

  const lastMsg = messages[messages.length - 1]
  const showSuggestions = hasMessages && !isLoading && lastMsg?.role === 'jarvis' && !!lastMsg.content

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(gap > 160)
  }, [])

  const handleArtifactClick = useCallback(async (artifact: MessageArtifact) => {
    if (artifact.content) {
      setActiveArtifact(artifact as Artifact)
      return
    }
    if (artifact.id) {
      // v0.3: fetchArtifact returns `content XOR uri`. ArtifactPanel's own effect resolves
      // the body via loadArtifactContent (fetch / Electron IPC) — we just pass the shape
      // through so both storage paths (legacy TEXT / new file-store) render identically.
      const full = await fetchArtifact(artifact.id)
      setActiveArtifact({
        type: full.type as Artifact['type'],
        title: full.title,
        content: full.content,
        uri: full.uri,
        language: full.language,
      })
    }
  }, [])

  const handleClear = useCallback(() => {
    if (!onClear) return
    onClear()
    setActiveArtifact(null)
    setArtifactFullscreen(false)
  }, [onClear])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Chat main */}
      {!artifactFullscreen && (
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column', minWidth: 200, borderRight: activeArtifact ? '1px solid var(--border)' : 'none' }}>
        {/* 顶栏 */}
        <ChatTopbar mood={mood} onClear={handleClear} hasMessages={hasMessages} monitorOpen={!!monitorOpen} onToggleMonitor={onToggleMonitor} />

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
          style={{ padding: '24px 24px 12px', position: 'relative' }}
        >
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', paddingTop: 60 }}>
              <p style={{ fontSize: 15, color: 'var(--text)', fontWeight: 550 }}>你好,Sir。有什么我能帮忙的?</p>
              <p style={{ fontSize: 12.5, marginTop: 6 }}>随时吩咐,我在。</p>
            </div>
          )}
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onArtifactClick={handleArtifactClick} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 推荐 chips(回复后出现,点击直接发送) */}
        {showSuggestions && (
          <div className="suggest-row">
            <span className="suggest-label">✦ 接下来</span>
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" className="suggest-chip" onClick={() => onSend(s)}>{s}</button>
            ))}
          </div>
        )}

        {/* Input(独立组件,自持状态,打字不重渲染消息列表)*/}
        <Composer onSend={onSend} />

        {showScrollBtn && (
          <button
            type="button"
            className="scroll-bottom-btn"
            style={{ position: 'fixed', bottom: 170 }}
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            title="回到底部"
          >
            <TopIcon.down />
          </button>
        )}
      </div>
      )}

      {/* Artifact Panel — pinned artifact takes priority over click-opened */}
      {(pinnedArtifact || activeArtifact) && (() => {
        const showing = pinnedArtifact || activeArtifact!
        const isPinned = !!pinnedArtifact
        return (
          <>
            {!artifactFullscreen && <ResizeHandle baseWidth={artifactWidth} onResize={setArtifactWidth} onDragStart={() => setResizing(true)} onDragEnd={() => setResizing(false)} />}
            <div style={{ width: artifactFullscreen ? '100%' : artifactWidth, flex: artifactFullscreen ? '1' : undefined, flexShrink: 0, height: '100%', position: 'relative' }}>
              {resizing && <div style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'col-resize' }} />}
              <ArtifactPanel
                artifact={showing}
                fullscreen={artifactFullscreen}
                onToggleFullscreen={() => setArtifactFullscreen(f => !f)}
                onClose={() => { if (isPinned) onUnpin?.(); else { setActiveArtifact(null); setArtifactFullscreen(false) } }}
              />
            </div>
          </>
        )
      })()}
    </div>
  )
}
