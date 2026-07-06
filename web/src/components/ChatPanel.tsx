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
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[#a0a0a0]">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#e94560] to-[#f06292] flex items-center justify-center text-white text-2xl font-bold mb-4">
              J
            </div>
            <p className="text-lg">你好，Sir。有什么我能帮忙的？</p>
            <p className="text-sm mt-1">随时吩咐，我在。</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-[#2a2a4a]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="跟 Jarvis 说点什么..."
            className="flex-1 bg-[#1a1a2e] border border-[#3a3a5a] rounded-xl px-4 py-3 text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#e94560] transition-colors"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-[#e94560] text-white rounded-xl text-sm font-medium hover:bg-[#d63850] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
