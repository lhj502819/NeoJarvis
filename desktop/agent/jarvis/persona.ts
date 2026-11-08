import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { docDelete, docGet, docList, docPut } from '../shared/docs.js'

/**
 * persona 配置层 —— Jarvis 的"可在线修改的策略"(DeepSeek 文章 §6 的产品化)。
 *
 * 三层来源,优先级从高到低:
 *   1. 用户运行时覆盖 —— 存通用文档表 jarvis_agent_docs(kind='persona-config',
 *      部署级全局,固定挂在 'system' 用户下;P4 起不再写 data/persona/ JSON 文件)
 *   2. config/defaults/… —— 仓库内置默认(随版本走,读文件)
 *   3. env              —— 兼容既有环境变量(仅 settings)
 *
 * 读取全程同步(热路径 think/watchdog 直调):启动时 initPersonaCache() 一次性
 * 加载进内存缓存,保存走 DB 并同步刷新缓存 —— "写入库、读走缓存"。
 * 首次启动发现旧 data/persona/ 文件则一次性导入并改名 .migrated 留档。
 *
 * 覆盖能力:
 *   - system-prompt.md          覆盖 Jarvis 人设/纪律全文(占位符见 prompt.ts)
 *   - skills/<name>/SKILL.md    覆盖内置 pipeline skill(如 message-router)
 *   - settings                  系统参数(watchdog/免打扰/频控/晨报/事件白名单)
 *   - agent-profile(研发分身)  仍由 agent-profile.ts 文件管理(结构化多文件,后续迁)
 */

const AGENT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULTS = join(AGENT_ROOT, 'config', 'defaults')
const LEGACY = join(process.cwd(), 'data', 'persona')

const DOC_KIND = 'persona-config'
const DOC_USER = 'system'   // persona 是部署级全局配置,与登录用户无关

/** 缓存:texts 缺失 = 未覆盖(回落默认文件) */
const cache: { loaded: boolean; settings: Record<string, any> | null; texts: Map<string, string> } = {
  loaded: false, settings: null, texts: new Map(),
}

/** 启动时调用:加载覆盖层进缓存;发现旧文件则一次性导入。失败降级默认,不阻塞启动。 */
export async function initPersonaCache(): Promise<void> {
  try {
    cache.settings = (await docGet<Record<string, unknown>>(DOC_USER, DOC_KIND, 'settings')) ?? null
    const sys = await docGet<string>(DOC_USER, DOC_KIND, 'system-prompt')
    if (sys !== null) cache.texts.set('system-prompt', sys)
    for (const item of await docList<string>(DOC_USER, DOC_KIND, 'skill:')) {
      cache.texts.set(item.key, item.data)
    }
    await migrateLegacyFiles()
    cache.loaded = true
    console.log('[persona] 配置缓存已加载(文档表)')
  } catch (err) {
    console.error(`[persona] 配置缓存加载失败(走默认+旧文件): ${err instanceof Error ? err.message : err}`)
    cache.loaded = true
  }
}

async function migrateLegacyFiles(): Promise<void> {
  let imported = 0
  // settings.json
  const legacySettings = join(LEGACY, 'settings.json')
  if (cache.settings === null && existsSync(legacySettings)) {
    try {
      const user = JSON.parse(readFileSync(legacySettings, 'utf-8'))
      await docPut(DOC_USER, DOC_KIND, 'settings', user)
      cache.settings = user
      renameSync(legacySettings, `${legacySettings}.migrated`)
      imported++
    } catch { /* 坏文件跳过 */ }
  }
  // system-prompt.md
  const legacyPrompt = join(LEGACY, 'system-prompt.md')
  if (!cache.texts.has('system-prompt') && existsSync(legacyPrompt)) {
    await docPut(DOC_USER, DOC_KIND, 'system-prompt', readFileSync(legacyPrompt, 'utf-8'))
    cache.texts.set('system-prompt', readFileSync(legacyPrompt, 'utf-8'))
    renameSync(legacyPrompt, `${legacyPrompt}.migrated`)
    imported++
  }
  // skills/<name>/SKILL.md
  const legacySkills = join(LEGACY, 'skills')
  if (existsSync(legacySkills)) {
    for (const name of readdirSync(legacySkills).sort()) {
      const f = join(legacySkills, name, 'SKILL.md')
      if (!existsSync(f) || cache.texts.has(`skill:${name}`)) continue
      await docPut(DOC_USER, DOC_KIND, `skill:${name}`, readFileSync(f, 'utf-8'))
      cache.texts.set(`skill:${name}`, readFileSync(f, 'utf-8'))
      renameSync(f, `${f}.migrated`)
      imported++
    }
  }
  if (imported > 0) console.log(`[persona] 旧配置文件已导入文档表(${imported} 项)`)
}

function readDefault(rel: string[]): string {
  const p = join(DEFAULTS, ...rel)
  try { return existsSync(p) ? readFileSync(p, 'utf-8') : '' } catch { return '' }
}

/** Jarvis 系统提示词模板(占位符 {{STATE_DESC}} {{MOOD}}… 由 prompt.ts 填充) */
export function loadSystemPromptTemplate(): string {
  const over = cache.texts.get('system-prompt')
  if (over !== undefined && over.trim()) return over
  return readDefault(['system-prompt.md'])
}

/** 内置 pipeline skill 正文(用户覆盖优先,回落仓库默认) */
export function loadPipelineSkillContent(name: string): string {
  const over = cache.texts.get(`skill:${name}`)
  if (over !== undefined && over.trim()) return over
  return readDefault(['skills', name, 'SKILL.md'])
}

// ── 系统参数 ──

export interface JarvisSettings {
  watchdog: { intervalMin: number; idleMin: number; maxMin: number; retryFailCount: number }
  quietHours: { startHour: number; endHour: number }
  proactive: { hourlyCap: number }
  morningReport: { at: string }
  events: { jdsmeGroups: string[] }
}

const DEFAULT_SETTINGS: JarvisSettings = {
  watchdog: { intervalMin: 5, idleMin: 10, maxMin: 30, retryFailCount: 2 },
  quietHours: { startHour: 23, endHour: 8 },
  proactive: { hourlyCap: 3 },
  morningReport: { at: '09:00' },
  events: { jdsmeGroups: [] },
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 合并用户覆盖(缓存)+ env(兼容既有变量)。同步读,热改即生效(保存时刷缓存)。 */
export function getSettings(): JarvisSettings {
  const s: JarvisSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  try {
    const user = cache.settings
    if (user) {
      if (user?.watchdog) s.watchdog = {
        intervalMin: num(user.watchdog.intervalMin, s.watchdog.intervalMin),
        idleMin: num(user.watchdog.idleMin, s.watchdog.idleMin),
        maxMin: num(user.watchdog.maxMin, s.watchdog.maxMin),
        retryFailCount: num(user.watchdog.retryFailCount, s.watchdog.retryFailCount),
      }
      if (user?.quietHours) s.quietHours = {
        startHour: num(user.quietHours.startHour, s.quietHours.startHour),
        endHour: num(user.quietHours.endHour, s.quietHours.endHour),
      }
      if (user?.proactive) s.proactive = { hourlyCap: num(user.proactive.hourlyCap, s.proactive.hourlyCap) }
      if (typeof user?.morningReport?.at === 'string') s.morningReport.at = user.morningReport.at
      if (Array.isArray(user?.events?.jdsmeGroups)) s.events.jdsmeGroups = user.events.jdsmeGroups.map(String)
    }
  } catch { /* 用户配置坏了就用默认,别崩 */ }

  // env 兼容(优先级最高,老用户无感)
  s.watchdog.intervalMin = num(process.env.JARVIS_WATCHDOG_INTERVAL_MIN, s.watchdog.intervalMin)
  s.watchdog.idleMin = num(process.env.JARVIS_WATCHDOG_IDLE_MIN, s.watchdog.idleMin)
  s.watchdog.maxMin = num(process.env.JARVIS_WATCHDOG_MAX_MIN, s.watchdog.maxMin)
  s.quietHours.startHour = num(process.env.JARVIS_QUIET_START_HOUR, s.quietHours.startHour)
  s.quietHours.endHour = num(process.env.JARVIS_QUIET_END_HOUR, s.quietHours.endHour)
  s.proactive.hourlyCap = num(process.env.JARVIS_PROACTIVE_HOURLY_CAP, s.proactive.hourlyCap)
  if (process.env.JARVIS_MORNING_REPORT_AT !== undefined) s.morningReport.at = process.env.JARVIS_MORNING_REPORT_AT

  return s
}

// ── 配置界面读写层(写 → 文档表 + 刷缓存;读 → 缓存,同步) ──

function isSafeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name)
}

export interface PersonaEditorState {
  systemPromptOverridden: boolean
  systemPrompt: string
  settingsOverridden: boolean
  builtinSkills: string[]
  overriddenSkills: string[]
}

/** 配置页总览:各覆盖层状态 + 生效内容 */
export function getPersonaState(): PersonaEditorState {
  const builtinSkills = listEditableSkills()
  return {
    systemPromptOverridden: cache.texts.has('system-prompt'),
    systemPrompt: loadSystemPromptTemplate(),
    settingsOverridden: cache.settings !== null,
    builtinSkills,
    overriddenSkills: builtinSkills.filter(name => cache.texts.has(`skill:${name}`)),
  }
}

export function getSystemPromptEditor(): { content: string; overridden: boolean; defaultContent: string } {
  return {
    content: loadSystemPromptTemplate(),
    overridden: cache.texts.has('system-prompt'),
    defaultContent: readDefault(['system-prompt.md']),
  }
}

/** content 为空串 = 删除覆盖,回内置默认 */
export async function saveSystemPromptOverride(content: string): Promise<void> {
  if (!content.trim()) {
    cache.texts.delete('system-prompt')
    await docDelete(DOC_USER, DOC_KIND, 'system-prompt').catch(() => {})
    return
  }
  cache.texts.set('system-prompt', content)
  await docPut(DOC_USER, DOC_KIND, 'system-prompt', content)
}

export function listEditableSkills(): string[] {
  const dir = join(DEFAULTS, 'skills')
  try { return existsSync(dir) ? readdirSync(dir).sort() : [] } catch { return [] }
}

export function getSkillEditor(name: string): { content: string; overridden: boolean; defaultContent: string } | null {
  if (!isSafeName(name)) return null
  const def = readDefault(['skills', name, 'SKILL.md'])
  if (!def) return null
  const over = cache.texts.get(`skill:${name}`)
  return { content: over !== undefined && over.trim() ? over : def, overridden: over !== undefined, defaultContent: def }
}

export async function saveSkillOverride(name: string, content: string): Promise<boolean> {
  if (!isSafeName(name)) return false
  if (!readDefault(['skills', name, 'SKILL.md'])) return false
  if (!content.trim()) {
    cache.texts.delete(`skill:${name}`)
    await docDelete(DOC_USER, DOC_KIND, `skill:${name}`).catch(() => {})
    return true
  }
  cache.texts.set(`skill:${name}`, content)
  await docPut(DOC_USER, DOC_KIND, `skill:${name}`, content)
  return true
}

export function getUserSettingsRaw(): Record<string, any> | null {
  return cache.settings
}

export async function saveUserSettingsRaw(user: Record<string, unknown>): Promise<void> {
  cache.settings = user
  await docPut(DOC_USER, DOC_KIND, 'settings', user)
}

export async function resetUserSettings(): Promise<void> {
  cache.settings = null
  await docDelete(DOC_USER, DOC_KIND, 'settings').catch(() => {})
}

// ── Sir 的身份(权限边界用,代码注入不可被对话改写) ──
//
// 权限模型的锚点:只有「唯一注册用户」是 Sir。谁在说话不重要——京ME 群里任何人
// @机器人、网页登录者,消息都会以同一个 userId 进 think;能证明说话人身份的只有
// 事件 payload 里的 sender pin 与配置的 ownerErp 比对。这里在每次构建 prompt 时
// 从 users 表现读(单机单主人:第一个注册用户即 Sir),不缓存、不信任任何对话内容。

export interface OwnerIdentity {
  username: string
  displayName: string
}

/** 读 Sir 身份:第一个注册用户(与 jdsme 源 resolveOwner 同规则)。读失败返回 null(降级不注身份段)。 */
export async function getOwnerIdentity(): Promise<OwnerIdentity | null> {
  try {
    const { listUsers } = await import('../auth/users.js')
    const users = await listUsers()
    const first = users[0]
    if (!first) return null
    return { username: first.username, displayName: first.displayName || first.username }
  } catch {
    return null
  }
}
