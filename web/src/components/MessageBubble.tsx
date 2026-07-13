import { useState, useEffect, memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, MessageArtifact } from '../api/hooks'
import './JarvisOrb.css'

interface Props {
  message: Message
  onArtifactClick?: (artifact: MessageArtifact) => void
}

function ThinkingIndicator({ content }: { content: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t0 = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
      <div className="jarvis-orb-wave" data-mood="thinking" style={{ height: 20, gap: 3 }}>
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <span>{content || '思考中...'}</span>
      {elapsed > 2 && <span style={{ fontSize: 11, opacity: 0.5 }}>{elapsed}s</span>}
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({ message, onArtifactClick }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 16, animation: 'msg-fade-in 0.3s ease-out' }}>
      <div
        style={{
          maxWidth: '100%',
          padding: '14px 18px',
          borderRadius: 12,
          background: isUser ? 'linear-gradient(135deg, rgba(34,211,238,0.16), rgba(34,211,238,0.06))' : 'var(--glass)',
          color: 'var(--text)',
          border: isUser ? '1px solid var(--border-focus)' : '1px solid var(--border)',
          borderLeft: isUser ? '1px solid var(--border-focus)' : '2px solid var(--accent)',
          backdropFilter: 'blur(4px)',
          boxShadow: isUser ? 'inset 0 0 16px rgba(34,211,238,0.06)' : 'none',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <div style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          marginBottom: 6,
          color: isUser ? 'var(--accent-hover)' : 'var(--accent)',
          letterSpacing: '0.14em',
          textShadow: 'var(--glow-text)',
        }}>
          {isUser ? 'SIR' : 'JARVIS'}
        </div>

        {message.imageUrls && message.imageUrls.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: message.content ? 8 : 0 }}>
            {message.imageUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', display: 'block' }}
                />
              </a>
            ))}
          </div>
        )}

        {message.status === 'thinking' ? (
          <ThinkingIndicator content={message.content} />
        ) : (
          message.content && (
            <div className="markdown-body">
              <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
            </div>
          )
        )}

        {message.artifact && onArtifactClick && (
          <button
            onClick={() => onArtifactClick(message.artifact!)}
            style={{
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-focus)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              transition: 'box-shadow 0.15s',
            }}
          >
            {message.artifact.type === 'html' && '🌐'}
            {message.artifact.type === 'markdown' && '📄'}
            {message.artifact.type === 'code' && '💻'}
            {message.artifact.type === 'mermaid' && '📊'}
            {message.artifact.title}
            <span style={{ opacity: 0.6 }}>→</span>
          </button>
        )}
      </div>
    </div>
  )
})
