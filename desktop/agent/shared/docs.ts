import { serverGet, serverPut, serverDelete } from './server-client.js'

/**
 * 通用文档存储客户端(superagent-v2 P0,docs/superagent-design-v2.md):
 * 智能层运行时状态的统一落点 —— jarvis_agent_docs 表(Java/PG)。
 * 原 JSON 侧车(task-origin/message-origin/jdsme游标/timeline/comms)一律迁到这里;
 * 新状态(Thread/Trigger/Subscription/审批)也必须走本模块,不再新建 JSON 文件。
 *
 * kind 命名空间约定(小写-连字符,每类关注点一个值):
 *   task-origin  taskId → 京ME来源聊天      message-origin  messageId → 消息来源
 *   timeline     messageId → 思考/工具时间线  comms           <at>-<rand> → 沟通日志条目
 *   jdsme-cursor 'state' → 京ME轮询游标
 */

const BASE = '/api/docs'

export interface DocItem<T> {
  key: string
  data: T
}

/** Upsert 一篇文档(同 (user,kind,key) 覆盖写)。 */
export async function docPut<T>(userId: string, kind: string, key: string, data: T): Promise<void> {
  await serverPut(userId, `${BASE}/${kind}/${encodeURIComponent(key)}`, { data })
}

/** 读一篇文档;不存在返回 null(其余错误照常抛出)。 */
export async function docGet<T>(userId: string, kind: string, key: string): Promise<T | null> {
  try {
    return await serverGet<T>(userId, `${BASE}/${kind}/${encodeURIComponent(key)}`)
  } catch (err) {
    if (err instanceof Error && / -> 404\b/.test(err.message)) return null
    throw err
  }
}

export async function docDelete(userId: string, kind: string, key: string): Promise<void> {
  await serverDelete(userId, `${BASE}/${kind}/${encodeURIComponent(key)}`)
}

/** 批量清空若干 kind 下的全部文档(分页拉取+逐条删;memory/reset 用)。
 *  幂等:重复调用安全。失败时抛出(调用方决定事务语义——reset 是破坏性操作,如实报错)。 */
export async function clearDocKinds(userId: string, kinds: string[]): Promise<number> {
  let removed = 0
  for (const kind of kinds) {
    for (;;) {
      const items = await docList(userId, kind, '', 500)
      if (items.length === 0) break
      for (const item of items) {
        await docDelete(userId, kind, item.key)
        removed++
      }
    }
  }
  return removed
}

/**
 * 列出一个 kind 下的文档,id 倒序(最新写入在前),可选按 key 前缀过滤。
 * 需要时间正序的调用方自行 reverse。
 */
export async function docList<T>(userId: string, kind: string, prefix = '', limit = 200): Promise<Array<DocItem<T>>> {
  const params = new URLSearchParams({ prefix, limit: String(limit) })
  const res = await serverGet<{ items: DocItem<T>[] }>(userId, `${BASE}/${kind}?${params.toString()}`)
  return res.items ?? []
}
