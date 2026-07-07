import { useState, useRef, useEffect } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../api/hooks'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSend: (text: string) => void
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    onSend(text)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ padding: '24px 32px' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <img
              src="/jarvis-logo.png"
              alt="Jarvis"
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)', marginBottom: 16 }}
            />
            <p style={{ fontSize: 16, color: 'var(--text-secondary)' }}>你好，Sir。有什么我能帮忙的？</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>随时吩咐，我在。</p>
          </div>
        )}
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ padding: '16px 32px', borderTop: '1px solid var(--border-light)' }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <input
            className="j-input"
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="跟 Jarvis 说点什么..."
            style={{ flex: 1, borderRadius: 'var(--radius)' }}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="j-btn j-btn-primary"
            style={{ padding: '10px 20px', borderRadius: 'var(--radius)' }}
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
