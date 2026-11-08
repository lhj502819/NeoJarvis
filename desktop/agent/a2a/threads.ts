import { docDelete, docGet, docList, docPut } from '../shared/docs.js'
import { getTask } from '../task/manager.js'
import { bus } from './bus.js'
import { broadcast } from '../jarvis/sse.js'
import { appendComms } from '../jarvis/timeline-store.js'
import type { TaskOrigin } from '../jarvis/task-origin.js'

/**
 * Thread / Trigger / Subscription(a2a 层,docs/superagent-design-v2.md P2)。
 *
 * 订阅直通(dsh 的 Subscription & Pass-through 机制):
 *   建任务即订阅来源群 → 同群后续消息**代码直通**执行中的小弟(不进 brain、不分诊),
 *   Router 只收通知;小弟判断不归自己 → handback 工具回流 Router 重评估。
 *
 * v1 边界(设计文档已定):
 *   - Thread = 群(京ME 无话题结构,v1 整群一线;细化聚类放 v2)
 *   - 仅"有执行中小弟"的任务接收直通;已结束/无在跑子任务回落 Router
 *     (Router 能看到任务卡与对话史,自行决定续派新活还是答话 —— 即 resume 语义)
 *   - 私聊不进 Thread 体系
 *
 * 全部状态存通用文档表(P0 硬约束):
 *   kind='trigger'      key=msgId            事件幂等/审计
 *   kind='thread'       key=threadKey        线程登记(label)
 *   kind='subscription' key=`${threadKey}:${taskId}`  任务↔线程订阅
 */

export const groupThreadKey = (chatId: string): string => `jdsme:group:${chatId}`

export interface TriggerPayload {
  msgId: string
  sender: string
  text: string
  chatId: string
  chatName: string
}

/** Trigger 入库(幂等):同 (thread,msgId) 只记一次。返回 false = 重复消息,调用方直接丢弃。
 *  key 按线程前缀存储(`${threadKey}:${msgId}`),供 threadWindow 按线程列窗口;
 *  京ME msgId 全局唯一,跨线程重名不存在。 */
export async function recordTrigger(userId: string, threadKey: string, p: TriggerPayload): Promise<boolean> {
  const key = `${threadKey}:${p.msgId}`
  const existing = await docGet(userId, 'trigger', key)
  if (existing) return false
  await docPut(userId, 'trigger', key, {
    threadKey, msgId: p.msgId, sender: p.sender, text: p.text.slice(0, 2000), at: Date.now(), human: true,
  })
  return true
}

/**
 * 评估窗口(dsh admission-context 的等价物):线程最近 N 条 Trigger 的紧凑视图,
 * 带 omitted 计数 —— 模型知道"看到的只是一段"。京ME无回复链元数据,v1 取时间序尾部。
 */
export async function threadWindow(userId: string, threadKey: string, count = 8): Promise<string> {
  const all = await docList<{ sender: string; text: string; at: number }>(userId, 'trigger', `${threadKey}:`, 50)
  if (all.length === 0) return ''
  const recent = all.slice(-count)
  const omitted = all.length - recent.length
  const lines = recent.map(i => {
    const d = i.data
    const time = new Date(d.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return `- [${time}] ${d.sender}: ${d.text.replace(/\s+/g, ' ').slice(0, 120)}`
  })
  return lines.join('\n') + (omitted > 0 ? `\n(更早 ${omitted} 条未显示)` : '')
}

export async function ensureThread(userId: string, threadKey: string, label: string): Promise<void> {
  const existing = await docGet(userId, 'thread', threadKey)
  if (!existing) await docPut(userId, 'thread', threadKey, { label, createdAt: Date.now() })
}

/** 建任务即订阅来源(P5):京ME群 → 群线程;行云需求卡 → 卡片线程。私聊不订阅。 */
export async function subscribeTask(userId: string, taskId: string, origin: TaskOrigin): Promise<void> {
  let threadKey: string
  let label: string
  if (origin.channel === 'xingyun') {
    threadKey = `xingyun:card:${origin.chatId}`
    label = origin.chatName
  } else if (origin.kind === 'group') {
    threadKey = groupThreadKey(origin.chatId)
    label = origin.chatName
  } else {
    return
  }
  await ensureThread(userId, threadKey, label)
  await docPut(userId, 'subscription', `${threadKey}:${taskId}`, {
    threadKey, taskId, kind: 'origin', chatId: origin.chatId, chatName: origin.chatName, createdAt: Date.now(),
  })
}

/** 任务取消时解除全部订阅(被 Sir 叫停的任务不再接收直通,消息回落 Router)。 */
export async function unsubscribeTaskEverywhere(userId: string, taskId: string): Promise<void> {
  const all = await docList<{ taskId: string }>(userId, 'subscription')
  for (const item of all) {
    if (item.data.taskId === taskId) await docDelete(userId, 'subscription', item.key)
  }
}

/** 某 Thread 下的全部订阅任务 id(不筛状态——存活判断在投递时做)。 */
export async function listSubscribers(userId: string, threadKey: string): Promise<string[]> {
  const all = await docList<{ threadKey: string; taskId: string }>(userId, 'subscription', `${threadKey}:`)
  return [...new Set(all.map(i => i.data.taskId))]
}

export interface DeliveryResult {
  delivered: boolean
  note: string
}

/**
 * 把一条群消息直通给任务的执行中小弟。投递成功返回 true;
 * 任务无执行中子任务 / 小弟会话不在线 → false(调用方回落 Router)。
 * 同时:消息进 web 聊天(user_message 广播)+ 沟通日志,让 Sir 看得见去向。
 */
export async function deliverToTask(
  userId: string, taskId: string, p: TriggerPayload,
  opts: { senderLabel: string; broadcastOnce?: (text: string) => void },
): Promise<DeliveryResult> {
  const task = await getTask(userId, taskId).catch(() => null)
  if (!task) return { delivered: false, note: '任务不存在' }
  const live = task.subtasks.find(st => st.status === 'running')
  if (!live) return { delivered: false, note: '无执行中的小弟' }
  if (!bus.isRegistered(live.id)) return { delivered: false, note: '小弟会话不在线' }

  const labeled = `【京ME 群「${p.chatName}」· ${opts.senderLabel} 追问】\n${p.text}\n\n(这是 Sir 或群成员在你任务来源群里的追问,直接关系到你手头的活。按需要继续干活或简短回应;若它与你的任务无关,用 handback 工具退回并说明原因。)`

  await bus.send(userId, 'jdsme', live.id, taskId, labeled, { type: 'follow_up', msgId: p.msgId, chatId: p.chatId, chatName: p.chatName })
  await appendComms(userId, {
    at: Date.now(), dir: 'to_worker', agentName: live.assignee, type: 'progress',
    content: `[群追问直通] ${p.text.slice(0, 400)}`,
  }).catch(() => {})
  opts.broadcastOnce?.(labeled)
  return { delivered: true, note: `已直通 ${live.assignee}` }
}

/** 群消息在 web 聊天的展示文本(直通与回落共用)。 */
export function formatGroupMessage(p: TriggerPayload, senderLabel: string): string {
  return `【京ME 群「${p.chatName}」· ${senderLabel}】\n${p.text}`
}
