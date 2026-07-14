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
    <div style={{
      marginBottom: 16,
      animation: 'msg-fade-in 0.3s ease-out',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'var(--gradient-aurora)',
          boxShadow: 'var(--glow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, marginTop: 2,
          color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em',
          fontFamily: 'var(--font-display)',
        }}>J</div>
      )}
      <div
        style={{
          maxWidth: '86%',
          padding: '14px 18px',
          borderRadius: 14,
          background: isUser
            ? 'linear-gradient(135deg, rgba(147,129,255,0.18), rgba(46,167,255,0.08))'
            : 'rgba(255,255,255,0.03)',
          color: 'var(--text)',
          border: `1px solid ${isUser ? 'var(--border-focus)' : 'var(--border)'}`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: isUser ? 'inset 0 0 16px rgba(147,129,255,0.08)' : 'none',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
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
              gap: 8,
              padding: '10px 14px',
              width: '100%',
              background: 'rgba(147,129,255,0.06)',
              border: '1px solid rgba(147,129,255,0.22)',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--accent-purple)',
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(147,129,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(147,129,255,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(147,129,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(147,129,255,0.22)' }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent-purple)', boxShadow: '0 0 6px var(--accent-purple)',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600, flex: 1 }}>{message.artifact.title}</span>
            <span style={{ opacity: 0.6, fontSize: 12 }}>→</span>
          </button>
        )}
      </div>
    </div>
  )
})
