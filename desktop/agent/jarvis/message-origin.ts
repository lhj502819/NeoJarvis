import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TaskOrigin } from './task-origin.js'

/**
 * 消息来源标记:京ME 进来的消息(以及 Jarvis 同步回京ME的回复)挂上来源,
 * /api/conversation 富化后前端在气泡上渲染京ME图标。
 *
 * 为什么落盘:同 task-origins —— 刷新/重启后对话历史还原时标记还要在,
 * 内存登记会丢。存 data/message-origins.json,按 userId → messageId 分桶
 * (id 只在用户内比对,即使服务端 id 按 user 独立自增也不会跨用户串标)。
 *
 * 不动对话表结构:消息本身是信道中立的,「从哪个聊天来」是事件层的事;
 * 对话落库走 Java/POST /api/conversation/messages,侧车登记不侵入该契约。
 */

const VERSION = 1
// 每用户只留最近 N 条标记:id 自增,超出裁最旧,文件不无限膨胀。
// 清空记忆(/api/memory/reset)后旧 id 不再匹配,残留条目无害,同样被此上限回收。
const MAX_PER_USER = 300
const statePath = join(process.cwd(), 'data', 'message-origins.json')

type OriginStore = { version: number; byUser: Record<string, Record<string, TaskOrigin>> }

let state: OriginStore = { version: VERSION, byUser: {} }
let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'))
    if (parsed?.version === VERSION && parsed.byUser) state = parsed
  } catch { /* 首次运行无文件 */ }
}

async function persist(): Promise<void> {
  try {
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8')
  } catch { /* 标记写失败不致命,只丢图标 */ }
}

export async function setMessageOrigin(userId: string, messageId: number, origin: TaskOrigin): Promise<void> {
  await load()
  const bucket = state.byUser[userId] ?? (state.byUser[userId] = {})
  bucket[String(messageId)] = origin
  const ids = Object.keys(bucket).map(Number).sort((a, b) => a - b)
  while (ids.length > MAX_PER_USER) delete bucket[String(ids.shift())]
  await persist()
}

/** /api/conversation 富化用:该用户所有消息的来源标记(无则空对象)。 */
export async function getOriginsFor(userId: string): Promise<Record<string, TaskOrigin>> {
  await load()
  return state.byUser[userId] ?? {}
}
