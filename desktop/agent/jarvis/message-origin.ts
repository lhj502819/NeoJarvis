import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { docDelete, docList, docPut } from '../shared/docs.js'
import type { TaskOrigin } from './task-origin.js'

/**
 * 消息来源标记:京ME 进来的消息(以及 Jarvis 同步回京ME的回复)挂上来源,
 * /api/conversation 富化后前端在气泡上渲染京ME图标。
 *
 * 存储(superagent-v2 P0):原 data/message-origins.json 侧车迁入通用文档表
 * jarvis_agent_docs(kind='message-origin',key=messageId,按用户天然隔离)。
 * 首次访问时旧文件一次性导入后改名留档。
 *
 * 不动对话表结构:消息本身是信道中立的,「从哪个聊天来」是事件层的事。
 */

const DOC_KIND = 'message-origin'
// 每用户只留最近 N 条标记:超出裁最旧,表不无限膨胀。
// 清空记忆(/api/memory/reset)后旧 id 不再匹配,残留条目无害,同样被此上限回收。
const MAX_PER_USER = 300
const legacyPath = (): string => join(process.cwd(), 'data', 'message-origins.json')

/** 旧 JSON 侧车一次性导入(含全部用户桶),导入后改名 .migrated 留档。 */
async function migrateLegacy(): Promise<void> {
  try {
    const { readFile } = await import('node:fs/promises')
    const parsed = JSON.parse(await readFile(legacyPath(), 'utf8'))
    const byUser: Record<string, Record<string, TaskOrigin>> = parsed?.byUser ?? {}
    let count = 0
    for (const [uid, bucket] of Object.entries(byUser)) {
      for (const [messageId, origin] of Object.entries(bucket)) {
        await docPut(uid, DOC_KIND, messageId, origin)
        count++
      }
    }
    await rename(legacyPath(), `${legacyPath()}.migrated`)
    console.log(`[message-origin] 旧 JSON 已导入文档表(${count} 条)`)
  } catch { /* 无旧文件或导入失败——走空状态,不阻塞 */ }
}

export async function setMessageOrigin(userId: string, messageId: number, origin: TaskOrigin): Promise<void> {
  await docPut(userId, DOC_KIND, String(messageId), origin)
  // 超出上限裁最旧:list 倒序,300 条之后的都是旧 id
  const all = await docList(userId, DOC_KIND, '', MAX_PER_USER + 50)
  if (all.length > MAX_PER_USER) {
    for (const item of all.slice(MAX_PER_USER)) {
      await docDelete(userId, DOC_KIND, item.key).catch(() => {})
    }
  }
}

/** /api/conversation 富化用:该用户所有消息的来源标记(messageId → origin)。 */
export async function getOriginsFor(userId: string): Promise<Record<string, TaskOrigin>> {
  let items = await docList<TaskOrigin>(userId, DOC_KIND)
  if (items.length === 0) {
    // 首次运行:尝试旧 JSON 侧车一次性导入
    await migrateLegacy()
    items = await docList<TaskOrigin>(userId, DOC_KIND)
  }
  const out: Record<string, TaskOrigin> = {}
  for (const item of items) out[item.key] = item.data
  return out
}
