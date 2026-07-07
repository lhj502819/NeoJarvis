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
        <div className="text-xs text-[#a0a0a0] bg-[#1a1a2e] px-3 py-1 rounded-full">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <img src="/jarvis-logo.png" alt="Jarvis" className="w-7 h-7 rounded-full object-cover shrink-0 mt-1 mr-2" />
      )}
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
        isUser
          ? 'bg-[#2a4a8a] text-white'
          : 'bg-[#1e1e3a] text-[#e8e8e8]'
      }`}>
        {message.status === 'thinking' ? (
          <div className="flex items-center gap-2 text-[#a0a0a0]">
            <span className="animate-pulse">●</span>
            <span className="text-sm">思考中...</span>
          </div>
        ) : message.status === 'streaming' && message.role === 'jarvis' && !message.content.includes('\n') ? (
          <div className="text-sm text-[#a0a0a0] italic">{message.content}</div>
        ) : (
          <div className="markdown-body text-sm leading-relaxed">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[#2a4a8a] flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1 ml-2">
          S
        </div>
      )}
    </div>
  )
}
