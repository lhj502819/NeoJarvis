import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchJSON, postJSON, streamChat, type ChatImagePayload } from './client'

export interface MessageArtifact {
  id?: string
  type: 'html' | 'markdown' | 'code' | 'mermaid'
  title: string
  content: string
  language?: string
}

export interface MsgStep {
  name: string
  args?: string
  status: 'running' | 'ok' | 'error'
}

/** 对话流时间线条目:思考段 / 工具调用,按发生顺序交错(ZCode 式) */
export interface MsgTimelineEntry {
  type: 'thought' | 'tool'
  /** thought: 累积的思考文本 */
  text?: string
  /** tool: 工具名 + 参数预览 */
  name?: string
  args?: string
  status: 'running' | 'ok' | 'error'
  startedAt: number
  endedAt?: number
}

/** 消息来源(京ME 群/私聊):前端据此在气泡上渲染京ME图标 */
export interface MessageOrigin {
  kind: 'group' | 'dm'
  chatId: string
  chatName: string
  /** 京ME发件人 ERP(非主人来件展示用) */
  sender?: string
  isOwner?: boolean
  /** 回报信道:行云需求卡来源时徽章显示"行云"而非"京ME" */
  channel?: 'jdsme' | 'xingyun'
}

export interface Message {
  id: string
  serverId?: number   // 服务端消息 id(时间线/轨迹按它关联)
  ts?: number         // 服务端时间戳(沟通卡片按它归位)
  role: 'user' | 'jarvis' | 'system'
  content: string
  status?: 'thinking' | 'streaming' | 'done'
  artifact?: MessageArtifact
  imageUrls?: string[]   // 用户消息附带的图片(展示用 URL:刚发的用 data URL,历史用 /api/chat-image/id)
  /** 思考/工具时间线(流式累积,仅本次会话内存中可见) */
  timeline?: MsgTimelineEntry[]
  /** 沟通卡片:小弟 ↔ Jarvis 的结构化往来 */
  kind?: 'comms'
  commsDir?: 'to_jarvis' | 'to_worker'
  commsType?: string
  agentName?: string
  /** 来源标记:京ME 群/私聊进来的消息与同步回去的回复 */
  origin?: MessageOrigin
}

// 找最后一条 jarvis 消息的下标(artifact 事件总在 response 后到达,需挂到已 done 的消息上)
function findLastJarvisIndex(msgs: Message[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'jarvis') return i
  }
  return -1
}

// ── 时间线维护(纯函数,不可变更新)—— 对话流的思考/工具交错行(ZCode 式)──

const tlCloseThought = (tl: MsgTimelineEntry[], now: number): MsgTimelineEntry[] => {
  const last = tl[tl.length - 1]
  if (last && last.type === 'thought' && last.status === 'running') {
    return [...tl.slice(0, -1), { ...last, status: 'ok', endedAt: now }]
  }
  return tl
}

const tlApplyThought = (tl: MsgTimelineEntry[], delta: string, now: number): MsgTimelineEntry[] => {
  const last = tl[tl.length - 1]
  if (last && last.type === 'thought' && last.status === 'running') {
    return [...tl.slice(0, -1), { ...last, text: (last.text ?? '') + delta }]
  }
  return [...tl, { type: 'thought', text: delta, status: 'running', startedAt: now }]
}

const tlApplyToolUse = (tl: MsgTimelineEntry[], name: string, args: string | undefined, now: number): MsgTimelineEntry[] => {
  const closed = tlCloseThought(tl, now)
  return [...closed, { type: 'tool', name, args, status: 'running', startedAt: now }]
}

const tlApplyToolDone = (tl: MsgTimelineEntry[], name: string, isError: boolean, now: number): MsgTimelineEntry[] => {
  const next = [...tl]
  for (let k = next.length - 1; k >= 0; k--) {
    const e = next[k]
    if (e.type === 'tool' && e.name === name && e.status === 'running') {
      next[k] = { ...e, status: isError ? 'error' : 'ok', endedAt: now }
      break
    }
  }
  return next
}

const tlCloseAllRunning = (tl: MsgTimelineEntry[], now: number): MsgTimelineEntry[] => {
  const closed = tlCloseThought(tl, now)
  return closed.map(e => e.status === 'running' ? { ...e, status: 'ok', endedAt: e.endedAt ?? now } : e)
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
        const turns = await fetchJSON<Array<{ id: number; role: string; content: string; timestamp: number; artifact?: { id: string; type: string; title: string }; imageIds?: string[]; origin?: MessageOrigin }>>('/api/conversation')
        if (turns.length > 0) {
          const msgs: Message[] = turns.map((t, i) => ({
            id: `h-${t.timestamp}-${i}`,
            serverId: t.id,
            ts: t.timestamp,
            role: t.role === 'user' ? 'user' as const : 'jarvis' as const,
            content: t.content,
            status: 'done' as const,
            artifact: t.artifact ? { type: t.artifact.type as MessageArtifact['type'], title: t.artifact.title, content: '', id: t.artifact.id } : undefined,
            imageUrls: t.imageIds?.map(id => `/api/chat-image/${id}`),
            origin: t.origin,
          }))
          // 保留 /events 可能已抢先追加的进行中气泡,避免整体替换把它冲掉
          setMessages(prev => {
            const live = prev.filter(m => m.role === 'jarvis' && (m.status === 'thinking' || m.status === 'streaming'))
            return [...msgs, ...live]
          })

          // 时间线(思考/工具)+ 沟通日志:随历史还原对话流(失败不阻塞历史展示)
          try {
            const [tlAll, commsRes] = await Promise.all([
              fetchJSON<{ timelines: Array<{ messageId: number; timeline: MsgTimelineEntry[] }> }>('/api/timeline/all'),
              fetchJSON<{ comms: Array<{ at: number; dir: 'to_jarvis' | 'to_worker'; agentName: string; type?: string; content: string }> }>('/api/comms'),
            ])
            const tlMap = new Map(tlAll.timelines.map(t => [t.messageId, t.timeline]))
            const withTl = msgs.map(m => ({ ...m, timeline: tlMap.get(m.serverId ?? -1) }))
            const commsMsgs: Message[] = commsRes.comms.map((c, i) => ({
              id: `c-h-${c.at}-${i}`,
              role: 'jarvis' as const,
              kind: 'comms' as const,
              commsDir: c.dir,
              commsType: c.type,
              agentName: c.agentName,
              content: c.content,
              status: 'done' as const,
              ts: c.at,
            }))
            // 沟通卡片按时间戳归位到消息流中
            const merged: Message[] = []
            let ci = 0
            for (const m of withTl) {
              const mTs = m.ts ?? Number.MAX_SAFE_INTEGER
              while (ci < commsMsgs.length && (commsMsgs[ci].ts ?? 0) <= mTs) merged.push(commsMsgs[ci++])
              merged.push(m)
            }
            while (ci < commsMsgs.length) merged.push(commsMsgs[ci++])

            setMessages(prev => {
              const live = prev.filter(m => m.role === 'jarvis' && (m.status === 'thinking' || m.status === 'streaming'))
              return [...merged, ...live]
            })
          } catch { /* 时间线/沟通日志拉取失败不阻塞历史 */ }
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
        const now = Date.now()
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: fullText, status: 'done' as const, timeline: tlCloseAllRunning(m.timeline ?? [], now) } : m
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

  const send = useCallback(async (text: string, images?: ChatImagePayload[]) => {
    // Don't abort previous — orchestrator handles buffering/merging server-side
    const imageUrls = images?.map(im => `data:${im.mediaType};base64,${im.data}`)
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, status: 'done', imageUrls }
    const jarvisMsg: Message = { id: `j-${Date.now()}`, role: 'jarvis', content: '', status: 'thinking' }

    // 若前一条 jarvis 消息还处于 thinking/streaming(用户在快速追问),清掉它。
    // orchestrator 会把用户两条消息 merge 成一次 response,只保留最新那条 thinking 气泡。
    setMessages(prev => {
      const cleaned = prev.filter(m => !(m.role === 'jarvis' && (m.status === 'thinking' || m.status === 'streaming')))
      return [...cleaned, userMsg, jarvisMsg]
    })
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const event of streamChat(text, controller.signal, images)) {
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
            const now = Date.now()
            return msgs.map((m, i) => {
              if (i !== msgs.length - 1) return m
              const base = m.status === 'thinking' ? '' : m.content
              return { ...m, content: base + event.content, status: 'streaming' as const, timeline: tlCloseThought(m.timeline ?? [], now) }
            })
          }
          if (event.type === 'thought_delta') {
            const now = Date.now()
            return msgs.map((m, i) => i !== msgs.length - 1 ? m : { ...m, timeline: tlApplyThought(m.timeline ?? [], event.content, now) })
          }
          if (event.type === 'tool_use') {
            try {
              const d = JSON.parse(event.content) as { name: string; args?: string }
              const now = Date.now()
              return msgs.map((m, i) => i !== msgs.length - 1 ? m : { ...m, timeline: tlApplyToolUse(m.timeline ?? [], d.name, d.args, now) })
            } catch { return msgs }
          }
          if (event.type === 'tool_done') {
            try {
              const d = JSON.parse(event.content) as { name: string; isError?: boolean }
              const now = Date.now()
              return msgs.map((m, i) => i !== msgs.length - 1 ? m : { ...m, timeline: tlApplyToolDone(m.timeline ?? [], d.name, !!d.isError, now) })
            } catch { return msgs }
          }
          if (event.type === 'response') {
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg?.content && lastMsg.content.length > 0 && lastMsg.status === 'streaming') {
              setIsLoading(false)
              const now = Date.now()
              return msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: event.content, status: 'done' as const, timeline: tlCloseAllRunning(m.timeline ?? [], now) } : m)
            }
            typewriterEffect(event.content)
            return msgs
          }
          if (event.type === 'artifact') {
            try {
              const artifact = JSON.parse(event.content) as MessageArtifact
              const idx = findLastJarvisIndex(msgs)
              if (idx >= 0) return msgs.map((m, i) => i === idx ? { ...m, artifact } : m)
            } catch { return msgs }
            return msgs
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
        // 兜底:SSE 流若正常结束却没等到 response(如后端重启/网络抖动导致连接 EOF),
        // 最后一条 jarvis 气泡会永久卡在 thinking/streaming。收尾时强制落地,避免残留 ——
        // 已有内容(streaming)保留为最终态,无内容(thinking)标一句中断提示。
        // 但打字机仍在跑时(typingRef 非空)不能动:那是正常 response 的逐字动画,会自己转 done。
        if (!typingRef.current) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== 'jarvis' || (last.status !== 'thinking' && last.status !== 'streaming')) return prev
            return prev.map((m, i) => i === prev.length - 1
              ? { ...m, status: 'done' as const, content: m.content || '[响应中断,请重试]' }
              : m)
          })
        }
      }
    }
  }, [typewriterEffect])

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { id: `s-${Date.now()}`, role: 'system', content, status: 'done' }])
  }, [])

  // 处理全局 /events 流的实时事件(刷新恢复 / 多标签页 / 后台任务报告)。
  // 发起方(本页 send 进行中,abortRef 非空)靠 /chat 流,忽略 /events 避免重复 ——
  // 但只忽略 live-reply(当前对话的实时回复);后台任务的独立汇报(task-report/task-error)
  // 与事件驱动的往来(event-reply:京ME 等来源触发 Jarvis 的应答)是异步产物,
  // 不是 /chat 流的重复,必须放行,否则边等汇报边发新消息会把汇报吞掉。
  const applyLiveEvent = useCallback((event: SSEEvent) => {
    const isBackgroundReport = event.source === 'task-report' || event.source === 'task-error' || event.source === 'event-reply'
    if (abortRef.current && !isBackgroundReport) return  // 本页是发起方,/chat 已在处理 live-reply

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
        case 'response': {
          // 只有 live-reply(当前对话的实时回复)才能就地更新 thinking 气泡;
          // task-report/task-error 是后台子任务的独立汇报,必须新气泡追加,否则会
          // 把用户刚发出/恢复出的 thinking 气泡当成自己的位置盖掉。
          const isLive = !event.source || event.source === 'live-reply' || (event.source === 'event-reply' && isLiveJarvis)
          if (isLive && isLiveJarvis) return updateLast({ content: event.content, status: 'done', timeline: tlCloseAllRunning(last.timeline ?? [], Date.now()) })
          return [...prev, { id: `j-live-${Date.now()}`, role: 'jarvis', content: event.content, status: 'done' }]
        }
        case 'user_message': {
          // 事件驱动:京ME 等来源触发的往来,把来件作为用户气泡补进聊天流
          try {
            const d = JSON.parse(event.content) as { text?: string; origin?: MessageOrigin }
            if (d?.text) return [...prev, { id: `u-ev-${Date.now()}`, role: 'user', content: d.text, status: 'done' as const, origin: d.origin }]
          } catch { /* ignore */ }
          return prev
        }
        case 'thought_delta': {
          const now = Date.now()
          if (!isLiveJarvis) return prev
          return updateLast({ timeline: tlApplyThought(last.timeline ?? [], event.content, now) })
        }
        case 'tool_use': {
          if (!isLiveJarvis) return prev
          try {
            const d = JSON.parse(event.content) as { name: string; args?: string }
            const now = Date.now()
            return updateLast({ timeline: tlApplyToolUse(last.timeline ?? [], d.name, d.args, now) })
          } catch { return prev }
        }
        case 'tool_done': {
          if (!isLiveJarvis) return prev
          try {
            const d = JSON.parse(event.content) as { name: string; isError?: boolean }
            const now = Date.now()
            return updateLast({ timeline: tlApplyToolDone(last.timeline ?? [], d.name, !!d.isError, now) })
          } catch { return prev }
        }
        case 'worker_msg':
        case 'jarvis_msg': {
          // 小弟 ↔ Jarvis 的结构化沟通卡片(独立气泡,不打断当前流)
          try {
            const d = JSON.parse(event.content) as { to?: string; subtaskId?: string; agentName?: string; type?: string; content: string }
            return [...prev, {
              id: `c-${Date.now()}`,
              role: 'jarvis' as const,
              kind: 'comms' as const,
              commsDir: event.type === 'worker_msg' ? 'to_jarvis' as const : 'to_worker' as const,
              commsType: d.type,
              agentName: d.agentName ?? d.to ?? '小弟',
              content: d.content,
              status: 'done' as const,
            }]
          } catch { return prev }
        }
        case 'artifact': {
          try {
            const artifact = JSON.parse(event.content) as MessageArtifact
            // live-reply 的 artifact 挂到最后一条 jarvis(通常就是刚 done 的那条);
            // task-report 的 artifact 挂到刚追加的"任务汇报"气泡(也是最后一条 jarvis)。
            // 两种情况都取 findLastJarvisIndex 即可。
            const idx = findLastJarvisIndex(prev)
            if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, artifact } : m)
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

  const clear = useCallback(async () => {
    // 真清:删后端对话 + 执行痕迹(团队小弟、制品库、配置保留),不可逆,先二次确认。
    if (!confirm('确定清空 Jarvis 的所有记忆?对话、任务、执行记录将永久删除,不可恢复。团队成员和制品库会保留。')) return
    try {
      const res = await postJSON<{ ok: boolean; error?: string }>('/api/memory/reset', {})
      if (!res.ok) {
        // 运行中拦截(409)等:后端拒绝就不清屏,提示用户。
        alert(res.error || '清空失败,请稍后再试')
        return
      }
    } catch {
      alert('清空失败,请检查网络后重试')
      return
    }
    // 后端删成功后再清 UI:中断进行中的流式、清空消息、复位状态。
    abortRef.current?.abort()
    setMessages([])
    setIsLoading(false)
    recentResponses.current = []
  }, [])

  return { messages, isLoading, send, addSystemMessage, pushJarvisMessage, applyLiveEvent, clear }
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
  /**
   * 事件来源(仅 response/artifact 关心):
   *   'live-reply' = 当前对话回复(与 /chat 流内容一致,可就地更新 thinking 气泡)
   *   'task-report'= 后台子任务完成的独立汇报,必须作为新气泡追加
   *   'task-error' = 子任务异常报错,新气泡追加
   *   undefined    = 旧协议或非文本事件(progress/subtask/...) — 默认按 live-reply 行为兜底
   */
  source?: string
  _seq?: number  // useSSE 打的单调递增序号,供消费方去重(events 数组封顶后下标不可靠)
}

export interface SubtaskEvent {
  subtaskId: string
  taskId: string
  agentName: string
  agentType?: 'permanent' | 'adhoc'
  taskName: string
  status: 'running' | 'done' | 'failed'
  turnCount: number
  currentAction?: string
  currentTool?: string
  elapsedMs?: number
  error?: string
}

export function parseSubtaskEvent(content: string): SubtaskEvent | null {
  try {
    const obj = JSON.parse(content)
    if (typeof obj?.subtaskId !== 'string') return null
    if (typeof obj?.taskId !== 'string') return null
    if (obj.status !== 'running' && obj.status !== 'done' && obj.status !== 'failed') return null
    return obj as SubtaskEvent
  } catch { return null }
}

export function useSSE(path: string) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<SSEEvent[]>([])
  const esRef = useRef<EventSource | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    const es = new EventSource(path)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        event._seq = ++seqRef.current  // 单调序号,消费方按它去重(数组封顶后下标失效)
        setEvents(prev => [...prev.slice(-50), event])
      } catch {}
    }
    es.onerror = () => setConnected(false)

    return () => { es.close(); esRef.current = null }
  }, [path])

  return { connected, events }
}
