import { think, addToBuffer } from './brain.js'
import { saveChatImages } from './conversation.js'
import { broadcast } from './sse.js'
import { setCurrentOrigin, type TaskOrigin } from './task-origin.js'
import { setMessageOrigin } from './message-origin.js'
import type { ChatImage } from '../shared/types.js'

const BUFFER_WINDOW_MS = 1500
const BUFFER_QUICK_MS = 100
const BUFFER_MAX_WINDOW_MS = 5000
const MAX_BUFFER_MESSAGES = 10

export interface SSEWriter {
  id: string
  send(type: string, content: string): void
  end(): void
  closed: boolean
}

interface BufferedMessage {
  text: string
  images?: ChatImage[]
  timestamp: number
  writer: SSEWriter
}

interface UserSession {
  state: 'idle' | 'buffering' | 'thinking'
  buffer: BufferedMessage[]
  bufferTimer: NodeJS.Timeout | null
  bufferStart: number
  abortController: AbortController | null
  thinkPromise: Promise<void> | null
  writers: SSEWriter[]
  liveContent: string  // 当前思考已生成内容,供刷新 catch-up
}

const sessions = new Map<string, UserSession>()

// ─── Pin state (per-user, in-memory) ───
const pinnedArtifacts = new Map<string, string>()

export function pinArtifact(userId: string, artifactId: string | null): void {
  if (artifactId) pinnedArtifacts.set(userId, artifactId)
  else pinnedArtifacts.delete(userId)
}

export function getPinnedArtifactId(userId: string): string | null {
  return pinnedArtifacts.get(userId) || null
}

function getSession(userId: string): UserSession {
  let s = sessions.get(userId)
  if (!s) {
    s = {
      state: 'idle',
      buffer: [],
      bufferTimer: null,
      bufferStart: 0,
      abortController: null,
      thinkPromise: null,
      writers: [],
      liveContent: '',
    }
    sessions.set(userId, s)
  }
  return s
}

function broadcastToWriters(writers: SSEWriter[], type: string, content: string) {
  for (const w of writers) {
    if (!w.closed) w.send(type, content)
  }
}

function endAllWriters(writers: SSEWriter[]) {
  for (const w of writers) {
    if (!w.closed) w.end()
  }
}

function allWritersClosed(session: UserSession): boolean {
  return session.writers.length > 0 && session.writers.every(w => w.closed)
}

export async function enqueueMessage(userId: string, text: string, writer: SSEWriter, images?: ChatImage[]): Promise<void> {
  const session = getSession(userId)
  session.writers.push(writer)
  console.log(`[orchestrator] enqueue: userId=${userId}, state=${session.state}, text="${text.slice(0, 30)}"${images?.length ? ` +${images.length}img` : ''}`)

  switch (session.state) {
    case 'idle':
      session.state = 'buffering'
      session.buffer = [{ text, images, timestamp: Date.now(), writer }]
      session.bufferStart = Date.now()
      session.bufferTimer = setTimeout(() => {
        flushBuffer(userId, session).catch(handleFlushError(session))
      }, BUFFER_QUICK_MS)
      break

    case 'buffering':
      extendBuffer(userId, session, text, writer, images)
      break

    case 'thinking':
      await interruptAndRebuffer(userId, session, text, writer, images)
      break
  }
}

// ─── 后台事件入队(事件驱动,docs/superagent-design.md §3)───
// 事件(晨报/京ME 消息)走 Jarvis 的完整 think(),但**绝不打断** Sir 正在进行的对话:
// idle → 直接开跑;否则排队,等当前思考结束(resetSession)后自动续跑。
// origin:事件来源聊天(京ME 群/私聊)。开跑时 setCurrentOrigin,think 期间
// create_task 读它登记任务来源;收尾清空。web 路径不传。
const pendingBackground = new Map<string, Array<{ text: string; writer: SSEWriter; origin?: TaskOrigin }>>()

export function enqueueBackgroundMessage(userId: string, text: string, writer: SSEWriter, origin?: TaskOrigin): void {
  const session = getSession(userId)
  if (session.state === 'idle') {
    console.log(`[orchestrator] background flush(now): "${text.slice(0, 40)}"`)
    startBackgroundThink(userId, session, text, writer, origin)
    return
  }
  const q = pendingBackground.get(userId) ?? []
  q.push({ text, writer, origin })
  pendingBackground.set(userId, q)
  console.log(`[orchestrator] background queued(${q.length}): "${text.slice(0, 40)}"`)
}

/** 该用户是否有后台消息在排队或正在 think(事件路径用于决定何时清 currentOrigin)。 */
export function hasQueuedOrRunningBackground(userId: string): boolean {
  const q = pendingBackground.get(userId)
  if (q && q.length > 0) return true
  const session = sessions.get(userId)
  return !!session && session.state === 'thinking'
}

function startBackgroundThink(userId: string, session: UserSession, text: string, writer: SSEWriter, origin?: TaskOrigin): void {
  // 借用 thinking 状态机;writer 是事件侧虚拟 writer,无 /chat 连接语义
  session.state = 'thinking'
  session.writers.push(writer)
  session.liveContent = ''

  const emit = (type: string, content: string) => {
    if (!writer.closed) writer.send(type, content)
    // web 聊天实时刷新:事件触发的往来以 source='event-reply' 广播到 /events,
    // 前端按独立气泡处理(isBackgroundReport 集合),不与当前对话的流式气泡纠缠
    if (type === 'user_message' || type === 'response' || type === 'thought_delta' || type === 'tool_use' || type === 'tool_done') {
      broadcast(type, content, userId, 'event-reply')
    }
  }

  const run = async () => {
    setCurrentOrigin(origin ?? null)
    try {
      emit('user_message', JSON.stringify({ text, origin: origin ?? undefined }))  // 让 Sir 在聊天里看到这条京ME来件(origin 供前端渲染京ME图标)
      // 落库 user 消息(事件来源文本,带【来源】标签)→ think()
      // 来源随消息登记落盘:刷新后 /api/conversation 富化,历史气泡仍显示京ME图标
      const userMsgId = await addToBuffer(userId, 'user', text)
      if (origin) await setMessageOrigin(userId, userMsgId, origin)
      const result = await think(userId, text, (progress) => emit('progress', progress), (delta) => {
        session.liveContent += delta
        emit('delta', delta)
      }, undefined, undefined, { onEvent: emit })
      session.liveContent = result.response
      emit('response', result.response)
      if (result.artifact) emit('artifact', JSON.stringify(result.artifact))
    } catch (err) {
      emit('response', `[错误] ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCurrentOrigin(null)
      writer.end()
      session.thinkPromise = null
      session.state = 'idle'
      session.writers = session.writers.filter(w => w !== writer)
      // 队列里还有后台事件 → 稍等一拍续跑(给真正的用户消息让路)
      const q = pendingBackground.get(userId)
      if (q && q.length > 0) {
        const next = q.shift()!
        setTimeout(() => {
          const s = sessions.get(userId)
          if (s && s.state === 'idle') startBackgroundThink(userId, s, next.text, next.writer, next.origin)
          else enqueueBackgroundMessage(userId, next.text, next.writer, next.origin)
        }, 500)
      }
    }
  }
  session.thinkPromise = run()
}

export function handleDisconnect(userId: string, writerId: string) {
  const session = sessions.get(userId)
  if (!session) return

  const w = session.writers.find(w => w.id === writerId)
  if (w) w.closed = true

  if (allWritersClosed(session)) {
    // 思考已启动:不中断,让它在后台跑完(结果落库 + 全局广播),刷新后可 catch-up
    // 仅 buffering 阶段(还没开始思考)可安全取消
    if (session.state === 'buffering') {
      cancelEverything(session)
    }
  }
}

export function getStatus(userId: string): { state: string; liveContent: string } {
  const session = sessions.get(userId)
  return { state: session?.state || 'idle', liveContent: session?.liveContent || '' }
}

function extendBuffer(userId: string, session: UserSession, text: string, writer: SSEWriter, images?: ChatImage[]) {
  session.buffer.push({ text, images, timestamp: Date.now(), writer })

  if (session.buffer.length >= MAX_BUFFER_MESSAGES) {
    if (session.bufferTimer) clearTimeout(session.bufferTimer)
    flushBuffer(userId, session).catch(handleFlushError(session))
    return
  }

  const elapsed = Date.now() - session.bufferStart
  if (elapsed >= BUFFER_MAX_WINDOW_MS) {
    if (session.bufferTimer) clearTimeout(session.bufferTimer)
    flushBuffer(userId, session).catch(handleFlushError(session))
    return
  }

  if (session.bufferTimer) clearTimeout(session.bufferTimer)
  session.bufferTimer = setTimeout(() => {
    flushBuffer(userId, session).catch(handleFlushError(session))
  }, BUFFER_WINDOW_MS)
}

function handleFlushError(session: UserSession) {
  return (err: any) => {
    console.error('[orchestrator] flushBuffer error:', err)
    broadcastToWriters(session.writers, 'response', `[错误] ${err.message || err}`)
    endAllWriters(session.writers)
    resetSession(session)
  }
}

async function interruptAndRebuffer(userId: string, session: UserSession, text: string, writer: SSEWriter, images?: ChatImage[]) {
  if (session.abortController) session.abortController.abort()

  const oldWriters = session.writers.filter(w => w !== writer)
  broadcastToWriters(oldWriters, 'interrupted', '收到新消息，正在重新思考...')

  if (session.thinkPromise) {
    await session.thinkPromise.catch(() => {})
  }

  endAllWriters(oldWriters)

  session.state = 'buffering'
  session.buffer = [{ text, images, timestamp: Date.now(), writer }]
  session.writers = [writer]
  session.bufferStart = Date.now()
  session.bufferTimer = setTimeout(() => {
    flushBuffer(userId, session).catch(handleFlushError(session))
  }, BUFFER_WINDOW_MS)
}

async function flushBuffer(userId: string, session: UserSession) {
  session.bufferTimer = null
  const messages = session.buffer.map(b => b.text)
  const merged = messages.join('\n')
  const images = session.buffer.flatMap(b => b.images ?? [])
  console.log(`[orchestrator] flush: ${messages.length} msgs, merged="${merged.slice(0, 50)}"${images.length ? ` +${images.length}img` : ''}`)

  session.buffer = []
  await executeThink(userId, session, merged, images)
}

async function executeThink(userId: string, session: UserSession, mergedMessage: string, images: ChatImage[] = []) {
  session.state = 'thinking'
  session.liveContent = ''

  const ac = new AbortController()
  session.abortController = ac

  // 先存图拿 id,再落 user 消息并挂上 image_ids(供刷新/历史回看)
  const imageIds = images.length ? await saveChatImages(userId, images) : undefined
  await addToBuffer(userId, 'user', mergedMessage, undefined, imageIds)

  const activeWriters = session.writers.filter(w => !w.closed)

  // 同时发本次 /chat 连接(低延迟)与全局 /events(刷新后其他页面可 catch-up)。
  // source='live-reply' 告诉前端:这是当前对话回复,允许直接更新 thinking 气泡。
  // onEvent:think() 内部的思考增量/工具调用事件也走同一条通道(对话流 UI 的折叠步骤)。
  const emit = (type: string, content: string) => {
    broadcastToWriters(activeWriters, type, content)
    broadcast(type, content, userId, 'live-reply')
  }
  const onEvent = (type: string, content: string) => emit(type, content)

  if (activeWriters.length > 1) {
    emit('merged', JSON.stringify({ count: activeWriters.length }))
  }
  emit('thinking', '正在思考...')

  let gotFirstDelta = false
  const heartbeatStages = ['正在启动引擎...', '正在加载上下文...', '正在深度思考...', '仍在思考，请稍候...']
  let heartbeatIdx = 0
  const heartbeat = setInterval(() => {
    if (gotFirstDelta || ac.signal.aborted) { clearInterval(heartbeat); return }
    if (heartbeatIdx < heartbeatStages.length) {
      emit('progress', heartbeatStages[heartbeatIdx])
      heartbeatIdx++
    }
  }, 3000)

  const doThink = async () => {
    try {
      const result = await think(userId, mergedMessage, (progress) => {
        emit('progress', progress)
      }, (delta) => {
        if (!gotFirstDelta) { gotFirstDelta = true; clearInterval(heartbeat) }
        session.liveContent += delta
        emit('delta', delta)
      }, ac.signal, images, { onEvent })

      if (ac.signal.aborted) return

      session.liveContent = result.response
      emit('response', result.response)
      if (result.artifact) {
        emit('artifact', JSON.stringify(result.artifact))
      }
    } catch (err) {
      if (ac.signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      emit('response', `[错误] ${msg}`)
    } finally {
      clearInterval(heartbeat)
      session.abortController = null
      session.thinkPromise = null

      if (!ac.signal.aborted) {
        endAllWriters(session.writers)
        resetSession(session)
      }
    }
  }

  session.thinkPromise = doThink()
  await session.thinkPromise
}

function cancelEverything(session: UserSession) {
  if (session.bufferTimer) {
    clearTimeout(session.bufferTimer)
  }
  if (session.abortController) {
    session.abortController.abort()
  }
  resetSession(session)
}

function resetSession(session: UserSession) {
  session.state = 'idle'
  session.buffer = []
  session.bufferTimer = null
  session.abortController = null
  session.thinkPromise = null
  session.writers = []
  session.liveContent = ''
}
