import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, MessageArtifact } from '../api/hooks'

interface Props {
  message: Message
  onArtifactClick?: (artifact: MessageArtifact) => void
}

export function MessageBubble({ message, onArtifactClick }: Props) {
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
          background: isUser ? 'var(--accent)' : 'var(--bg-elevated)',
          color: isUser ? 'var(--text-on-accent)' : 'var(--text)',
          border: isUser ? 'none' : '1px solid var(--border)',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <div style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          marginBottom: 6,
          color: isUser ? 'rgba(255,255,255,0.6)' : 'var(--accent)',
          letterSpacing: '0.05em',
        }}>
          {isUser ? 'SIR' : 'JARVIS'}
        </div>

        {message.status === 'thinking' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isUser ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
            <span className="animate-pulse">●</span>
            <span>思考中...</span>
          </div>
        ) : (
          <div className="markdown-body">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          </div>
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
              background: isUser ? 'rgba(255,255,255,0.15)' : 'var(--accent-light)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: isUser ? '#fff' : 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              transition: 'opacity 0.15s',
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
}
