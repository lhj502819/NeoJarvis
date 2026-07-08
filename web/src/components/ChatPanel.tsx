import { useState, useRef, useEffect } from 'react'
import { MessageBubble } from './MessageBubble'
import { JarvisOrb, type OrbMood } from './JarvisOrb'
import { ArtifactPanel, type Artifact } from './ArtifactPanel'
import { fetchArtifact } from '../api/client'
import type { Message, MessageArtifact } from '../api/hooks'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSend: (text: string) => void
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const [input, setInput] = useState('')
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    onSend(text)
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

  const mood: OrbMood = showThinking ? 'thinking' : hasMessages ? 'happy' : 'idle'

  const handleArtifactClick = async (artifact: MessageArtifact) => {
    if (artifact.content) {
      setActiveArtifact(artifact as Artifact)
      return
    }
    if (artifact.id) {
      const full = await fetchArtifact(artifact.id)
      setActiveArtifact(full as Artifact)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Chat main */}
      <div style={{ flex: activeArtifact ? '0 0 440px' : '1', display: 'flex', flexDirection: 'column', transition: 'flex 0.3s ease', minWidth: 0, borderRight: activeArtifact ? '1px solid var(--border)' : 'none' }}>
        {/* Orb */}
        <JarvisOrb mood={mood} />

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
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 6px 6px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="对 Jarvis 说点什么..."
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, outline: 'none', color: 'var(--text)', fontFamily: 'var(--font)' }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                width: 34, height: 34, borderRadius: '50%', border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: !input.trim() ? 0.4 : 1,
                transition: 'opacity 0.15s, transform 0.15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-5-5 12-2-5-5-2z" fill="currentColor"/></svg>
            </button>
          </div>
        </form>
      </div>

      {/* Artifact Panel */}
      {activeArtifact && (
        <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
      )}
    </div>
  )
}
