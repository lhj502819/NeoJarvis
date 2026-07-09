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
  // 记录最近已显示的 jarvis response 内容,用于 /events 去重:
  // 普通对话 /chat 已显示的 response,/events 会重复广播同一条,靠内容指纹跳过。
  const recentResponses = useRef<string[]>([])
  const rememberResponse = (content: string) => {
    recentResponses.current.push(content)
    if (recentResponses.current.length > 10) recentResponses.current.shift()
  }

  useEffect(() => {
    if (historyLoaded.current) return
    historyLoaded.current = true
    // 串行:先铺历史(整体替换),再追加进行中的思考气泡,避免两次 setMessages 竞态覆盖
    ;(async () => {
      try {
        const turns = await fetchJSON<Array<{ role: string; content: string; timestamp: number; artifact?: { id: string; type: string; title: string } }>>('/api/conversation')
        if (turns.length > 0) {
          const msgs: Message[] = turns.map((t, i) => ({
            id: `h-${t.timestamp}-${i}`,
            role: t.role === 'user' ? 'user' as const : 'jarvis' as const,
            content: t.content,
            status: 'done' as const,
            artifact: t.artifact ? { type: t.artifact.type as MessageArtifact['type'], title: t.artifact.title, content: '', id: t.artifact.id } : undefined,
          }))
          // 保留 /events 可能已抢先追加的进行中气泡,避免整体替换把它冲掉
          setMessages(prev => {
            const live = prev.filter(m => m.role === 'jarvis' && (m.status === 'thinking' || m.status === 'streaming'))
            return [...msgs, ...live]
          })
        }
      } catch { /* ignore */ }

      try {
        const { state, liveContent } = await fetchJSON<{ state: string; liveContent: string }>('/api/chat/status')
        if (state === 'thinking' || state === 'buffering') {
          setIsLoading(true)
          setMessages(prev => {
            // 若 /events 已抢先追加进行中气泡,则不再重复追加
            const hasLive = prev.some(m => m.role === 'jarvis' && (m.status === 'thinking' || m.status === 'streaming'))
            if (hasLive) return prev
            return [...prev, {
              id: `j-resume-${Date.now()}`,
              role: 'jarvis',
              content: liveContent || '正在思考...',
              status: liveContent ? 'streaming' : 'thinking',
            }]
          })
        }
      } catch { /* ignore */ }
    })()
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
    // Don't abort previous — orchestrator handles buffering/merging server-side
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, status: 'done' }
    const jarvisMsg: Message = { id: `j-${Date.now()}`, role: 'jarvis', content: '', status: 'thinking' }

    setMessages(prev => [...prev, userMsg, jarvisMsg])
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const event of streamChat(text, controller.signal)) {
        // response 指纹记录在 setMessages 外(纯 ref),供 /events 去重用
        if (event.type === 'response') rememberResponse(event.content)
        setMessages(prev => {
          const msgs = [...prev]
          const last = msgs[msgs.length - 1]
          if (last.role !== 'jarvis') return msgs

          if (event.type === 'buffering') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'thinking' as const } : m)
          }
          if (event.type === 'merged') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: '正在综合思考你的消息...', status: 'thinking' as const } : m)
          }
          if (event.type === 'interrupted') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'done' as const } : m)
          }
          if (event.type === 'thinking') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, status: 'thinking' as const } : m)
          }
          if (event.type === 'progress') {
            return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'thinking' as const } : m)
          }
          if (event.type === 'delta') {
            return msgs.map((m, i) => {
              if (i !== msgs.length - 1) return m
              const base = m.status === 'thinking' ? '' : m.content
              return { ...m, content: base + event.content, status: 'streaming' as const }
            })
          }
          if (event.type === 'response') {
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg?.content && lastMsg.content.length > 0 && lastMsg.status === 'streaming') {
              setIsLoading(false)
              return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'done' as const } : m)
            }
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

  // 处理全局 /events 流的实时事件(刷新恢复 / 多标签页 / 后台任务报告)。
  // 发起方(本页 send 进行中,abortRef 非空)靠 /chat 流,忽略 /events 避免重复。
  const applyLiveEvent = useCallback((event: SSEEvent) => {
    if (abortRef.current) return  // 本页是发起方,/chat 已在处理

    // response 去重:判断在 setMessages updater 之外做(纯 ref,避免 React 严格模式 updater 重入污染)
    if (event.type === 'response') {
      if (recentResponses.current.includes(event.content)) return  // /chat 已显示过,跳过
      rememberResponse(event.content)
      setIsLoading(false)
    }

    setMessages(prev => {
      const last = prev[prev.length - 1]
      const isLiveJarvis = last && last.role === 'jarvis' && (last.status === 'thinking' || last.status === 'streaming')

      const updateLast = (patch: Partial<Message>) =>
        prev.map((m, i) => i === prev.length - 1 ? { ...m, ...patch } : m)

      switch (event.type) {
        case 'progress':
          if (isLiveJarvis) return updateLast({ content: event.content, status: 'thinking' })
          return [...prev, { id: `j-live-${Date.now()}`, role: 'jarvis', content: event.content, status: 'thinking' }]
        case 'delta': {
          if (isLiveJarvis) {
            const base = last.status === 'thinking' ? '' : last.content
            return updateLast({ content: base + event.content, status: 'streaming' })
          }
          return [...prev, { id: `j-live-${Date.now()}`, role: 'jarvis', content: event.content, status: 'streaming' }]
        }
        case 'response':
          if (isLiveJarvis) return updateLast({ content: event.content, status: 'done' })
          return [...prev, { id: `j-live-${Date.now()}`, role: 'jarvis', content: event.content, status: 'done' }]
        case 'artifact': {
          try {
            const artifact = JSON.parse(event.content) as MessageArtifact
            if (isLiveJarvis) return updateLast({ artifact })
          } catch { /* ignore */ }
          return prev
        }
        default:
          return prev
      }
    })
  }, [])

  const pushJarvisMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { id: `j-bg-${Date.now()}`, role: 'jarvis', content, status: 'done' }])
    setIsLoading(false)
  }, [])

  return { messages, isLoading, send, addSystemMessage, pushJarvisMessage, applyLiveEvent }
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
