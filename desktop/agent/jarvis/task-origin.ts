import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { docGet, docDelete, docList, docPut } from '../shared/docs.js'

/**
 * 任务来源登记:京ME 群/私聊里派的活儿,完成后汇报要同步回来源聊天。
 *
 * 存储(superagent-v2 P0):原先的 data/task-origins.json 侧车已迁入通用文档表
 * jarvis_agent_docs(kind='task-origin',key=taskId)——运行时状态一律进数据库,
 * 不再写 JSON 文件。首次访问时旧文件内容一次性导入,导入后旧文件改名留档。
 *
 * 不动 Task 表结构:任务本身是平台中立的,「从哪个聊天来」是事件层的事。
 */

const DOC_KIND = 'task-origin'
const legacyPath = (): string => join(process.cwd(), 'data', 'task-origins.json')

export type TaskOrigin = {
  kind: 'group' | 'dm'
  chatId: string
  chatName: string
  /** 京ME发件人 ERP(消息来源徽章:非主人来件要亮出是谁) */
  sender?: string
  /** 发件人是否为配置的主人(Sir),router 比对 ownerErp 后写入 */
  isOwner?: boolean
  /** 回报信道:xingyun = 需求卡来源,复盘不回京ME(P5) */
  channel?: 'jdsme' | 'xingyun'
}

/** 旧 JSON 侧车一次性导入:首次按用户读空时执行,导入后旧文件改名 .migrated 留档。 */
async function migrateLegacy(userId: string): Promise<void> {
  try {
    const { readFile } = await import('node:fs/promises')
    const parsed = JSON.parse(await readFile(legacyPath(), 'utf8'))
    const origins: Record<string, TaskOrigin> = parsed?.origins ?? {}
    for (const [taskId, origin] of Object.entries(origins)) {
      await docPut(userId, DOC_KIND, taskId, origin)
    }
    await rename(legacyPath(), `${legacyPath()}.migrated`)
    console.log(`[task-origin] 旧 JSON 已导入文档表(${Object.keys(origins).length} 条)`)
  } catch { /* 无旧文件或导入失败——走空状态,不阻塞 */ }
}

export async function setTaskOrigin(userId: string, taskId: string, origin: TaskOrigin): Promise<void> {
  await docPut(userId, DOC_KIND, taskId, origin)
}

export async function getTaskOrigin(userId: string, taskId: string): Promise<TaskOrigin | null> {
  const doc = await docGet<TaskOrigin>(userId, DOC_KIND, taskId).catch(async err => {
    // 表还没建/Java 未升级等异常降级:尝试旧文件直读,保住"办完了要回群说一声"
    console.error(`[task-origin] 文档表读取失败,回退旧 JSON: ${err instanceof Error ? err.message : err}`)
    return legacyGet(taskId)
  })
  if (doc !== null) return doc
  // 未命中且文档表整体为空 → 可能是首次运行,尝试旧 JSON 导入后再查一次
  const rest = await docList(userId, DOC_KIND, '', 1)
  if (rest.length === 0) {
    await migrateLegacy(userId)
    return docGet<TaskOrigin>(userId, DOC_KIND, taskId)
  }
  return null
}

/** 任务收尾清理:汇报同步完成后删掉登记,表不无限膨胀。 */
export async function clearTaskOrigin(userId: string, taskId: string): Promise<void> {
  await docDelete(userId, DOC_KIND, taskId)
}

async function legacyGet(taskId: string): Promise<TaskOrigin | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const parsed = JSON.parse(await readFile(legacyPath(), 'utf8'))
    return parsed?.origins?.[taskId] ?? null
  } catch {
    return null
  }
}

// ── 当前对话来源(think 生命周期内有效) ──
// 事件路径进来的 think(),其 create_task 调用要能知道"这次对话从哪个聊天来"。
// 模块级变量即可:同一用户的 think 被 brainLock 串行化,不会并发串台;web 路径不设置。
let currentOrigin: TaskOrigin | null = null

export function setCurrentOrigin(origin: TaskOrigin | null): void {
  currentOrigin = origin
}

/** create_task 时读;读后不清,一次 think 里可能连建多个任务,都该登记。 */
export function peekCurrentOrigin(): TaskOrigin | null {
  return currentOrigin
}
