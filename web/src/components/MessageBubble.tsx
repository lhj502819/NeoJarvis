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

/**
 * Codex 式消息布局:
 *   user  → 右侧浅灰圆角气泡(无头像),用 --bubble-user-* 变量
 *   jarvis → 无气泡纯文本,占满栏宽,靠排版区分
 * system → 居中灰 pill
 */
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

  if (isUser) {
    return (
      <div style={{
        marginBottom: 20,
        animation: 'msg-fade-in 0.3s ease-out',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <div
          style={{
            maxWidth: '70%',
            padding: message.imageUrls?.length ? '10px 14px' : '10px 16px',
            borderRadius: 22,
            background: 'var(--bubble-user-bg)',
            color: 'var(--bubble-user-fg)',
            border: '1px solid var(--bubble-user-border)',
            boxShadow: 'var(--bubble-user-shadow)',
            fontSize: 14,
            lineHeight: 1.65,
          }}
        >
          {message.imageUrls && message.imageUrls.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: message.content ? 8 : 0 }}>
              {message.imageUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    style={{ maxWidth: 180, maxHeight: 180, borderRadius: 12, display: 'block' }}
                  />
                </a>
              ))}
            </div>
          )}
          {message.content}
        </div>
      </div>
    )
  }

  // Jarvis:无气泡纯文本(Codex 风)
  return (
    <div style={{
      marginBottom: 24,
      animation: 'msg-fade-in 0.3s ease-out',
      fontSize: 14.5,
      lineHeight: 1.7,
      color: 'var(--text)',
    }}>
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
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--text)',
            fontFamily: 'inherit',
            textAlign: 'left',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-subtle)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--text-muted)',
            flexShrink: 0,
          }} />
          <span style={{ fontWeight: 600, flex: 1 }}>{message.artifact.title}</span>
          <span style={{ opacity: 0.6, fontSize: 12 }}>→</span>
        </button>
      )}
    </div>
  )
})
