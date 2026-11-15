import { docDelete, docGet, docList, docPut } from '../shared/docs.js'
import { getSettings, getUserSettingsRaw, saveUserSettingsRaw } from './persona.js'

/**
 * 定时任务(配置页「定时任务」分区)。
 *
 * 用户任务存文档表 kind='cron-task',key=任务 id —— 与 source-instance/approval 同一套机制,
 * 备份/迁移随文档表走。内置任务「每日晨报」不在表里:它由 data/persona/settings.json 的
 * morningReport 驱动(老行为),这里只做统一展示/启停的适配层。
 *
 * 任务模型(简单版):名称 + 每天/每周几 + HH:mm + 一句话指令 + 启停。
 * 到点由 cron 源 emit 'scheduled_task' 事件,router 把指令交给 Jarvis 完整 think。
 */

export type ScheduleFreq = 'daily' | 'weekly'

export interface ScheduleTask {
  id: string
  name: string
  /** 内置任务(晨报):不可删除,启停写 settings */
  builtin?: boolean
  enabled: boolean
  freq: ScheduleFreq
  /** 每周几:0=周日,1..6=周一到周六;daily 时为空 */
  days: number[]
  /** 'HH:mm' 本地时间 */
  time: string
  cmd: string
  last?: { at: string; ok: boolean }
  /** 间隔型内置任务(转正巡检):每 N 分钟一次,恒为 builtin */
  everyMinutes?: number
  createdAt?: number
  updatedAt?: number
}

const KIND = 'cron-task'
const MAX_TASKS = 30

/** 内置晨报的统一视图(便于前端把内置和用户任务渲染成同一种行) */
export function getBuiltinMorningTask(): ScheduleTask {
  const s = getSettings()
  return {
    id: 'builtin-morning',
    name: '每日晨报',
    builtin: true,
    enabled: s.morningReport.enabled !== false && !!s.morningReport.at.trim(),
    freq: 'daily',
    days: [],
    time: s.morningReport.at || '09:00',
    cmd: '汇总昨天团队完成的活和今天排期，生成晨报给我。',
  }
}

/** 内置转正巡检的统一视图(间隔型任务,配置页展示/启停/调间隔)。 */
export function getBuiltinPromotionTask(): ScheduleTask {
  const s = getSettings()
  const every = Number.isFinite(s.promotionWatch.intervalMin) && s.promotionWatch.intervalMin > 0
    ? s.promotionWatch.intervalMin
    : 60
  return {
    id: 'builtin-promotion',
    name: '转正巡检',
    builtin: true,
    enabled: s.promotionWatch.enabled !== false,
    freq: 'daily',
    days: [],
    time: '',
    everyMinutes: every,
    cmd: '巡检临时工的累计执行次数,达转正线(≥3 次)时提醒 Sir 转正。',
  }
}

/** 启停/调间隔内置转正巡检:写 settings 覆盖层,保留其它字段。 */
export async function setBuiltinPromotionConfig(patch: { enabled?: boolean; everyMinutes?: number }): Promise<ScheduleTask> {
  const raw = (getUserSettingsRaw() ?? {}) as Record<string, unknown>
  const current = (typeof raw.promotionWatch === 'object' && raw.promotionWatch)
    ? raw.promotionWatch as Record<string, unknown>
    : {}
  const enabled = patch.enabled === undefined ? current.enabled !== false : patch.enabled !== false
  const every = Number(patch.everyMinutes ?? current.intervalMin ?? 60)
  raw.promotionWatch = { ...current, enabled, intervalMin: Number.isFinite(every) && every > 0 ? Math.min(1440, every) : 60 }
  await saveUserSettingsRaw(raw)
  return getBuiltinPromotionTask()
}

/** 启停内置晨报:写用户 settings 覆盖层,保留其它字段。 */
export async function setBuiltinMorningEnabled(enabled: boolean): Promise<ScheduleTask> {
  const raw = (getUserSettingsRaw() ?? {}) as Record<string, unknown>
  const morning = (typeof raw.morningReport === 'object' && raw.morningReport) ? raw.morningReport as Record<string, unknown> : {}
  // 停用不丢时间配置:保留 at,只翻 enabled;启用时若 at 为空回填 09:00
  const at = typeof morning.at === 'string' && morning.at.trim() ? morning.at : '09:00'
  raw.morningReport = { ...morning, at, enabled }
  await saveUserSettingsRaw(raw)
  return getBuiltinMorningTask()
}

export async function listScheduleTasks(userId: string): Promise<ScheduleTask[]> {
  const all = await docList<ScheduleTask>(userId, KIND, '', MAX_TASKS)
  return all
    .map(i => i.data)
    .filter(t => t && typeof t.id === 'string' && !t.builtin)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

export async function getScheduleTask(userId: string, id: string): Promise<ScheduleTask | null> {
  return await docGet<ScheduleTask>(userId, KIND, id)
}

export interface ScheduleInput {
  name: string
  freq: ScheduleFreq
  days?: number[]
  time: string
  cmd: string
  enabled?: boolean
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** 校验并归一化输入;非法时抛错(路由转 400)。 */
export function normalizeScheduleInput(input: unknown): Required<Pick<ScheduleInput, 'name' | 'freq' | 'time' | 'cmd'>> & { days: number[]; enabled: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('任务格式不正确')
  const raw = input as Record<string, unknown>
  const name = String(raw.name ?? '').trim().slice(0, 30)
  if (!name) throw new Error('任务名称不能为空')
  const cmd = String(raw.cmd ?? '').trim().slice(0, 300)
  if (!cmd) throw new Error('指令不能为空')
  const time = String(raw.time ?? '').trim()
  if (!TIME_RE.test(time)) throw new Error('时间格式应为 HH:mm')
  const freq: ScheduleFreq = raw.freq === 'weekly' ? 'weekly' : 'daily'
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : []
  if (freq === 'weekly' && days.length === 0) throw new Error('每周任务至少选一天')
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false
  return { name, cmd, time, freq, days: freq === 'weekly' ? days : [], enabled }
}

export async function createScheduleTask(userId: string, input: unknown): Promise<ScheduleTask> {
  const normalized = normalizeScheduleInput(input)
  const existing = await listScheduleTasks(userId)
  if (existing.length >= MAX_TASKS) throw new Error(`最多 ${MAX_TASKS} 个定时任务,先删掉不用的`)
  const task: ScheduleTask = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...normalized,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await docPut(userId, KIND, task.id, task)
  return task
}

export async function updateScheduleTask(userId: string, id: string, patch: unknown): Promise<ScheduleTask> {
  const current = await getScheduleTask(userId, id)
  if (!current || current.builtin) throw new Error('任务不存在')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('任务格式不正确')
  const merged = { ...current, ...(patch as Record<string, unknown>) }
  // 局部更新(如仅启停)也走同一套校验,保证存储里永远是合法任务
  const normalized = normalizeScheduleInput(merged)
  const task: ScheduleTask = { ...current, ...normalized, id, updatedAt: Date.now() }
  await docPut(userId, KIND, id, task)
  return task
}

export async function deleteScheduleTask(userId: string, id: string): Promise<boolean> {
  const current = await getScheduleTask(userId, id)
  if (!current || current.builtin) return false
  await docDelete(userId, KIND, id)
  return true
}

/** 记录一次触发(执行是否成功用于列表状态点;失败也如实记)。 */
export async function markTaskLastRun(userId: string, id: string, ok: boolean): Promise<void> {
  const current = await getScheduleTask(userId, id).catch(() => null)
  if (!current) return
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const at = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  await docPut(userId, KIND, id, { ...current, last: { at, ok } }).catch(() => {})
}

/**
 * 下一次触发时间(纯函数,单测覆盖)。找不到(每周但没选天)返回 null。
 * 本地时区;严格大于 now。
 */
export function nextFireTime(freq: ScheduleFreq, days: number[], time: string, now = new Date()): Date | null {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const base = new Date(now)
  base.setSeconds(0, 0)
  base.setHours(h, m, 0, 0)
  if (freq === 'daily') {
    if (base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1)
    return base
  }
  if (!days.length) return null
  for (let i = 0; i <= 8; i++) {
    const cand = new Date(base)
    cand.setDate(base.getDate() + i)
    if (days.includes(cand.getDay()) && cand.getTime() > now.getTime()) return cand
  }
  return null
}
