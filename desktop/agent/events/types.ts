/**
 * 事件系统类型(docs/superagent-design.md §3)。
 *
 * JarvisEvent 是所有触发源的标准化输出:京ME 消息、定时晨报、将来的行云/GitHub,
 * 都归一成这个形状再进 router,router 不感知来源细节。
 */

export type EventSourceId = 'cron' | 'jdsme'

export interface JarvisEvent {
  id: string
  source: EventSourceId
  /** 事件类型:cron 源 'morning_report';jdsme 源 'im_message' */
  type: string
  /** 事件归属用户(= Jarvis 服务该的人) */
  userId: string
  /** 类型相关的结构化数据(见各 source) */
  payload: Record<string, unknown>
  /** 原始报文,排查用 */
  raw?: unknown
  receivedAt: number
}

/** 京ME 消息事件的 payload */
export interface ImMessagePayload {
  kind: 'group' | 'dm'
  /** 群号 / 对方 erp */
  chatId: string
  chatName: string
  sender: string
  text: string
  msgId: string
}

/** 回复出口:事件处理完,结果怎么送回"事件来的地方" */
export interface EventSink {
  id: string
  /** 把一段最终文本送回该事件来源的会话(如京ME 群/私聊) */
  reply(userId: string, ev: JarvisEvent, text: string): Promise<void>
}

/** 事件源接口 */
export interface EventSourceDef {
  id: EventSourceId
  start(ctx: { emit(ev: JarvisEvent): void }): void
  stop(): void
}

/** orchestrator SSEWriter 的结构化复刻(避免循环依赖) */
export interface SSEWriterLike {
  id: string
  send(type: string, content: string): void
  end(): void
  closed: boolean
}
