import { docDelete, docGet, docList, docPut } from '../shared/docs.js'

/**
 * MCP 异步消息的回复收件箱。
 *
 * message_jarvis(wait=false) 投递后,Jarvis 的回复原本只出现在 web 聊天流;
 * 外部 agent 拿不到。这里把「msgId → 最终回复」落文档表,并配 check_jarvis_reply
 * 让调用方轮询取回:
 *   - 投递时写 pending
 *   - 后台 think 产出最终回复时改写 done + reply
 *   - 进程重启导致没等到结果 → 超过 10 分钟视为 expired(调用方知道别再等)
 *
 * 保留最近 100 条,防文档表无限增长。
 */

const KIND = 'mcp-reply'
const KEEP = 100
const EXPIRE_MS = 10 * 60_000

export interface McpReply {
  id: string
  status: 'pending' | 'done' | 'expired'
  question: string
  from: string
  reply?: string
  createdAt: number
  doneAt?: number
}

export async function createPendingReply(userId: string, id: string, question: string, from: string): Promise<void> {
  const record: McpReply = { id, status: 'pending', question: question.slice(0, 200), from, createdAt: Date.now() }
  await docPut(userId, KIND, id, record)
  void pruneReplies(userId)
}

export async function completeReply(userId: string, id: string, reply: string): Promise<void> {
  const current = await docGet<McpReply>(userId, KIND, id).catch(() => null)
  if (!current) return
  await docPut(userId, KIND, id, { ...current, status: 'done', reply, doneAt: Date.now() })
}

export async function getReply(userId: string, id: string): Promise<McpReply | null> {
  const record = await docGet<McpReply>(userId, KIND, id).catch(() => null)
  if (!record) return null
  // pending 但已超时(进程重启等导致永远等不到)→ 按 expired 返回
  if (record.status === 'pending' && Date.now() - record.createdAt > EXPIRE_MS) {
    return { ...record, status: 'expired' }
  }
  return record
}

async function pruneReplies(userId: string): Promise<void> {
  try {
    const all = await docList<McpReply>(userId, KIND, '', KEEP + 40)
    if (all.length <= KEEP) return
    // docList 按 id 倒序(最新在前):保留最新 KEEP 条,删 KEEP 之后的旧记录
    for (const item of all.slice(KEEP)) {
      await docDelete(userId, KIND, item.key).catch(() => {})
    }
  } catch { /* 裁剪失败不影响主流程 */ }
}

export const _internals = { KIND, KEEP, EXPIRE_MS }
