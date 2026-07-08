import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchJSON, streamChat } from './client'

export interface MessageArtifact {
  id?: string
  type: 'html' | 'markdown' | 'code' | 'mermaid'
  title: string
  content: string
  language?: string
}

export interface Message {
  id: string
  role: 'user' | 'jarvis' | 'system'
  content: string
  status?: 'thinking' | 'streaming' | 'done'
  artifact?: MessageArtifact
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const historyLoaded = useRef(false)
  const typingRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (historyLoaded.current) return
    historyLoaded.current = true
    fetchJSON<Array<{ role: string; content: string; timestamp: number; artifact?: { id: string; type: string; title: string } }>>('/api/conversation')
      .then(turns => {
        if (turns.length === 0) return
        const msgs: Message[] = turns.map((t, i) => ({
          id: `h-${t.timestamp}-${i}`,
          role: t.role === 'user' ? 'user' as const : 'jarvis' as const,
          content: t.content,
          status: 'done' as const,
          artifact: t.artifact ? { type: t.artifact.type as MessageArtifact['type'], title: t.artifact.title, content: '', id: t.artifact.id } : undefined,
        }))
        setMessages(msgs)
      })
      .catch(() => {})
  }, [])

  const typewriterEffect = useCallback((fullText: string) => {
    if (typingRef.current) cancelAnimationFrame(typingRef.current)
    let idx = 0
    const chunkSize = 2
    const step = () => {
      idx += chunkSize
      if (idx >= fullText.length) {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: fullText, status: 'done' as const } : m
        ))
        setIsLoading(false)
        typingRef.current = null
        return
      }
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: fullText.slice(0, idx), status: 'streaming' as const } : m
      ))
      typingRef.current = requestAnimationFrame(step)
    }
    step()
  }, [])

  const send = useCallback(async (text: string) => {
    // Abort previous request if still in progress
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (typingRef.current) {
      cancelAnimationFrame(typingRef.current)
      typingRef.current = null
    }

    // Mark any pending jarvis message as done
    setMessages(prev => prev.map(m =>
      m.role === 'jarvis' && m.status !== 'done'
        ? { ...m, status: 'done' as const, content: m.content || '[已打断]' }
        : m
    ))

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, status: 'done' }
    const jarvisMsg: Message = { id: `j-${Date.now()}`, role: 'jarvis', content: '', status: 'thinking' }

    setMessages(prev => [...prev, userMsg, jarvisMsg])
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const event of streamChat(text, controller.signal)) {
        setMessages(prev => {
          const msgs = [...prev]
          const last = msgs[msgs.length - 1]
          if (last.role !== 'jarvis') return msgs

          if (event.type === 'thinking') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, status: 'thinking' as const } : m)
          }
          if (event.type === 'progress') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'streaming' as const } : m)
          }
          if (event.type === 'delta') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: m.content + event.content, status: 'streaming' as const } : m)
          }
          if (event.type === 'response') {
            typewriterEffect(event.content)
            return msgs
          }
          if (event.type === 'artifact') {
            try {
              const artifact = JSON.parse(event.content) as MessageArtifact
              return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, artifact } : m)
            } catch { return msgs }
          }
          return msgs
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: `[错误] ${err instanceof Error ? err.message : '未知错误'}`, status: 'done' as const } : m
      ))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setIsLoading(false)
      }
    }
  }, [typewriterEffect])

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { id: `s-${Date.now()}`, role: 'system', content, status: 'done' }])
  }, [])

  const pushJarvisMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { id: `j-bg-${Date.now()}`, role: 'jarvis', content, status: 'done' }])
    setIsLoading(false)
  }, [])

  return { messages, isLoading, send, addSystemMessage, pushJarvisMessage }
}

export function usePolling<T>(path: string, interval: number) {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const result = await fetchJSON<T>(path)
        if (active) setData(result)
      } catch {}
    }
    poll()
    const timer = setInterval(poll, interval)
    return () => { active = false; clearInterval(timer) }
  }, [path, interval])

  return data
}

export interface SSEEvent {
  type: string
  content: string
  timestamp?: string
}

export function useSSE(path: string) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<SSEEvent[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(path)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        setEvents(prev => [...prev.slice(-50), event])
      } catch {}
    }
    es.onerror = () => setConnected(false)

    return () => { es.close(); esRef.current = null }
  }, [path])

  return { connected, events }
}
