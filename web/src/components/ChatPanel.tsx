import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { ArtifactPanel, type Artifact } from './ArtifactPanel'
export type { Artifact }
import { fetchArtifact, type ChatImagePayload } from '../api/client'
import { usePolling } from '../api/hooks'
import type { Message, MessageArtifact } from '../api/hooks'

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

/** Aurora 头部状态条:Jarvis · 在线 · N 个 Agent 待命 + 清除按钮 */
function ChatHeader({ mood, onClear, hasMessages }: { mood: 'thinking' | 'happy' | 'idle'; onClear?: () => void; hasMessages: boolean }) {
  const running = usePolling<Array<{ subtaskId: string }>>('/api/agents', 5000)
  const count = running?.length ?? 0
  const statusText = mood === 'thinking' ? '思考中' : `在线 · ${count} 个 Agent ${count > 0 ? '在跑' : '待命'}`
  const dotColor = mood === 'thinking' ? 'var(--accent-purple)' : 'var(--green)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 24px', borderBottom: '1px solid var(--border-light)',
      background: 'rgba(255,255,255,0.015)', backdropFilter: 'blur(12px)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'var(--gradient-aurora)', boxShadow: 'var(--glow)',
          flexShrink: 0,
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Jarvis</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: dotColor, boxShadow: `0 0 6px ${dotColor}`,
              display: 'inline-block',
              animation: mood === 'thinking' ? 'msg-fade-in 0.6s ease-in-out infinite alternate' : undefined,
            }} />
            {statusText}
          </span>
        </div>
      </div>
      {hasMessages && onClear && (
        <button
          onClick={onClear}
          type="button"
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 12,
            padding: '6px 14px', borderRadius: 'var(--radius-full)',
            cursor: 'pointer', fontFamily: 'inherit',
            transition: 'color 0.15s, background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >清除</button>
      )}
    </div>
  )
}

export function ChatPanel({ messages, onSend, onClear, pinnedArtifact, onUnpin }: Props) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<ChatImagePayload[]>([])
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [artifactWidth, setArtifactWidth] = useState(440)
  const [artifactFullscreen, setArtifactFullscreen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  const addFiles = async (files: FileList | File[]) => {
    const payloads = (await Promise.all(Array.from(files).map(fileToPayload))).filter((p): p is ChatImagePayload => !!p)
    if (payloads.length) setPending(prev => [...prev, ...payloads])
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text && pending.length === 0) return
    setInput('')
    const images = pending
    setPending([])
    onSend(text, images.length ? images : undefined)
  }

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

  const handleArtifactClick = useCallback(async (artifact: MessageArtifact) => {
    if (artifact.content) {
      setActiveArtifact(artifact as Artifact)
      return
    }
    if (artifact.id) {
      const full = await fetchArtifact(artifact.id)
      setActiveArtifact(full as Artifact)
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
        {/* Header 状态条 */}
        <ChatHeader mood={mood} onClear={handleClear} hasMessages={hasMessages} />

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 20px 12px' }}>
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', paddingTop: 40 }}>
              <p style={{ fontSize: 15, color: 'var(--text-secondary)' }}>你好，Sir。有什么我能帮忙的？</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>随时吩咐，我在。</p>
            </div>
          )}
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onArtifactClick={handleArtifactClick} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: '10px 20px 16px', flexShrink: 0 }}
        >
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {/* 待发图片缩略图 */}
            {pending.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {pending.map((im, i) => (
                  <div key={i} style={{ position: 'relative', width: 56, height: 56 }}>
                    <img
                      src={`data:${im.mediaType};base64,${im.data}`}
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setPending(prev => prev.filter((_, j) => j !== i))}
                      style={{
                        position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                        border: 'none', background: 'var(--red, #e5484d)', color: '#fff', cursor: 'pointer',
                        fontSize: 11, lineHeight: '18px', padding: 0, textAlign: 'center',
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8, paddingLeft: 4 }}>
              支持 Shift + Enter 换行 · 输入 / 唤起技能
            </div>
            <div className="chat-composer" style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--glass)', border: '1px solid var(--border-focus)', borderRadius: 'var(--radius)', padding: '6px 6px 6px 10px', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 20px rgba(147, 129, 255, 0.05)' }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="添加图片"
                style={{
                  width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent',
                  color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              </button>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onPaste={handlePaste}
                placeholder="对 Jarvis 说点什么..."
                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, outline: 'none', color: 'var(--text)', fontFamily: 'var(--font)' }}
              />
              <button
                type="submit"
                disabled={!input.trim() && pending.length === 0}
                style={{
                  width: 34, height: 34, borderRadius: '50%', border: 'none',
                  background: 'var(--accent)', color: 'var(--text-on-accent)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: (!input.trim() && pending.length === 0) ? 0.4 : 1,
                  boxShadow: (!input.trim() && pending.length === 0) ? 'none' : 'var(--glow)',
                  transition: 'opacity 0.15s, transform 0.15s, box-shadow 0.15s',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-5-5 12-2-5-5-2z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>
        </form>
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
