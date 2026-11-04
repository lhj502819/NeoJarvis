import type { EventSink, JarvisEvent, SSEWriterLike } from './types.js'

// SSEWriter 形状来自 orchestrator(避免循环依赖,这里结构化复刻)
type SSEWriter = SSEWriterLike

/**
 * 事件路径的虚拟 Writer。
 *
 * orchestrator.enqueueMessage 需要 SSEWriter(通常来自 /chat 连接);事件没有这种连接。
 * EventWriter 借用该通道跑完整的 think(),但:
 *   - delta/progress:不外发(事件来源侧不需要流式;web 端由 executeThink 内部的
 *     broadcast(…, 'live-reply') 兜底,刷新可 catch-up)
 *   - response:最终文本回给来源 sink(如京ME 机器人),同时已在 web 聊天流可见
 */
export function createEventWriter(userId: string, ev: JarvisEvent, sinks: EventSink[]): SSEWriter {
  let finalText = ''
  let finished = false

  const deliver = () => {
    if (finished) return
    finished = true
    const text = finalText || '(无回复)'
    for (const sink of sinks) {
      sink.reply(userId, ev, text).catch(err =>
        console.error(`[events] sink ${sink.id} 回复失败:`, err instanceof Error ? err.message : err))
    }
  }

  return {
    id: `event-${ev.id}`,
    closed: false,
    send(type: string, content: string) {
      if (type === 'response') {
        finalText = content
        deliver()
      }
      // 其他类型忽略
    },
    end() {
      this.closed = true
      deliver()  // 思考被中断/无 response 时也兜底回一句
    },
  }
}
