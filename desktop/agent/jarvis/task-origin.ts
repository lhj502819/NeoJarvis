import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 任务来源登记:京ME 群/私聊里派的活儿,完成后汇报要同步回来源聊天。
 *
 * 为什么落盘:任务执行跨越进程重启(热重载/手动重启)后 recoverInterruptedTasks
 * 会补结算 + 补汇报,内存登记会丢;来源丢失 = 群里永远等不到那声「办完了」。
 * 存 data/task-origins.json,量小(taskId → 聊天标识),整文件读写即可。
 *
 * 不动 Task 表结构:任务本身是平台中立的,「从哪个聊天来」是事件层的事。
 */

const VERSION = 1
const statePath = join(process.cwd(), 'data', 'task-origins.json')

export type TaskOrigin = {
  kind: 'group' | 'dm'
  chatId: string
  chatName: string
  /** 京ME发件人 ERP(消息来源徽章:非主人来件要亮出是谁) */
  sender?: string
  /** 发件人是否为配置的主人(Sir),router 比对 ownerErp 后写入 */
  isOwner?: boolean
}

let state: { version: number; origins: Record<string, TaskOrigin> } = { version: VERSION, origins: {} }
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'))
    if (parsed?.version === VERSION && parsed.origins) state = parsed
  } catch { /* 首次运行无文件 */ }
}

async function persist(): Promise<void> {
  try {
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch { /* 登记写失败不致命,只丢同步 */ }
}

export async function setTaskOrigin(taskId: string, origin: TaskOrigin): Promise<void> {
  await load()
  state.origins[taskId] = origin
  await persist()
}

export async function getTaskOrigin(taskId: string): Promise<TaskOrigin | null> {
  await load()
  return state.origins[taskId] ?? null
}

/** 任务收尾清理:汇报同步完成后删掉登记,文件不无限膨胀。 */
export async function clearTaskOrigin(taskId: string): Promise<void> {
  await load()
  if (state.origins[taskId]) {
    delete state.origins[taskId]
    await persist()
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
