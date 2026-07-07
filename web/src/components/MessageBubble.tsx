import Markdown from 'react-markdown'
import type { Message } from '../api/hooks'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <img
          src="/jarvis-logo.png"
          alt="Jarvis"
          className="w-7 h-7 rounded-full object-cover shrink-0 mt-1 mr-2"
          style={{ border: '1px solid var(--border)' }}
        />
      )}
      <div
        style={{
          maxWidth: '75%',
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? 'var(--accent)' : 'var(--bg-subtle)',
          color: isUser ? 'var(--text-on-accent)' : 'var(--text)',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        {message.status === 'thinking' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            <span className="animate-pulse">●</span>
            <span>思考中...</span>
          </div>
        ) : message.status === 'streaming' && message.role === 'jarvis' && !message.content.includes('\n') ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{message.content}</div>
        ) : (
          <div className="markdown-body">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
      </div>
      {isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--accent-light)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
            marginTop: 4,
            marginLeft: 8,
          }}
        >
          S
        </div>
      )}
    </div>
  )
}
