import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/**
 * persona 配置层 —— Jarvis 的"可在线修改的策略"(DeepSeek 文章 §6 的产品化)。
 *
 * 三层来源,优先级从高到低:
 *   1. data/persona/…   —— 用户运行时覆盖(gitignored,热改即生效:每次调用现读)
 *   2. config/defaults/…—— 仓库内置默认(随版本走)
 *   3. env              —— 兼容既有环境变量(仅 settings)
 *
 * 覆盖能力:
 *   - system-prompt.md          覆盖 Jarvis 人设/纪律全文(占位符见 prompt.ts)
 *   - skills/<name>/SKILL.md    覆盖内置 pipeline skill(如 message-router)
 *   - settings.json             系统参数(watchdog/免打扰/频控/晨报/事件白名单)
 */

const AGENT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULTS = join(AGENT_ROOT, 'config', 'defaults')
const OVERRIDES = join(process.cwd(), 'data', 'persona')

function readFirst(...paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (existsSync(p)) return readFileSync(p, 'utf-8')
    } catch { /* 权限/IO 问题当作不存在,继续下一层 */ }
  }
  return null
}

/** Jarvis 系统提示词模板(占位符 {{STATE_DESC}} {{MOOD}}… 由 prompt.ts 填充) */
export function loadSystemPromptTemplate(): string {
  return readFirst(
    join(OVERRIDES, 'system-prompt.md'),
    join(DEFAULTS, 'system-prompt.md'),
  ) ?? ''
}

/** 内置 pipeline skill 正文(data/persona/skills/<name>/SKILL.md 可覆盖) */
export function loadPipelineSkillContent(name: string): string {
  return readFirst(
    join(OVERRIDES, 'skills', name, 'SKILL.md'),
    join(DEFAULTS, 'skills', name, 'SKILL.md'),
  ) ?? ''
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

/** 合并用户覆盖 + env(兼容既有变量)。每次调用现读,支持热改。 */
export function getSettings(): JarvisSettings {
  const s: JarvisSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  try {
    const file = join(OVERRIDES, 'settings.json')
    if (existsSync(file)) {
      const user = JSON.parse(readFileSync(file, 'utf-8'))
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

// ── 配置界面读写层(热改即生效:读取方每次现读) ──

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

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
  const sysOver = join(OVERRIDES, 'system-prompt.md')
  const setOver = join(OVERRIDES, 'settings.json')
  const builtinSkills = existsSync(join(DEFAULTS, 'skills'))
    ? readdirSafe(join(DEFAULTS, 'skills'))
    : []
  const overriddenSkills = builtinSkills.filter(name =>
    existsSync(join(OVERRIDES, 'skills', name, 'SKILL.md')))
  return {
    systemPromptOverridden: existsSync(sysOver),
    systemPrompt: loadSystemPromptTemplate(),
    settingsOverridden: existsSync(setOver),
    builtinSkills,
    overriddenSkills,
  }
}

export function getSystemPromptEditor(): { content: string; overridden: boolean; defaultContent: string } {
  return {
    content: loadSystemPromptTemplate(),
    overridden: existsSync(join(OVERRIDES, 'system-prompt.md')),
    defaultContent: readFileSync(join(DEFAULTS, 'system-prompt.md'), 'utf-8'),
  }
}

/** content 为空串 = 删除覆盖,回内置默认 */
export function saveSystemPromptOverride(content: string): void {
  const target = join(OVERRIDES, 'system-prompt.md')
  if (!content.trim()) {
    if (existsSync(target)) unlinkSync(target)
    return
  }
  ensureDir(target)
  writeFileSync(target, content, 'utf-8')
}

export function listEditableSkills(): string[] {
  return existsSync(join(DEFAULTS, 'skills')) ? readdirSafe(join(DEFAULTS, 'skills')) : []
}

export function getSkillEditor(name: string): { content: string; overridden: boolean; defaultContent: string } | null {
  if (!isSafeName(name)) return null
  const def = join(DEFAULTS, 'skills', name, 'SKILL.md')
  if (!existsSync(def)) return null
  const over = join(OVERRIDES, 'skills', name, 'SKILL.md')
  return {
    content: existsSync(over) ? readFileSync(over, 'utf-8') : readFileSync(def, 'utf-8'),
    overridden: existsSync(over),
    defaultContent: readFileSync(def, 'utf-8'),
  }
}

export function saveSkillOverride(name: string, content: string): boolean {
  if (!isSafeName(name)) return false
  const def = join(DEFAULTS, 'skills', name, 'SKILL.md')
  if (!existsSync(def)) return false
  const target = join(OVERRIDES, 'skills', name, 'SKILL.md')
  if (!content.trim()) {
    if (existsSync(target)) unlinkSync(target)
    return true
  }
  ensureDir(target)
  writeFileSync(target, content, 'utf-8')
  return true
}

export function getUserSettingsRaw(): unknown {
  const file = join(OVERRIDES, 'settings.json')
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
}

export function saveUserSettingsRaw(user: Record<string, unknown>): void {
  const target = join(OVERRIDES, 'settings.json')
  ensureDir(target)
  writeFileSync(target, `${JSON.stringify(user, null, 2)}\n`, 'utf-8')
}

export function resetUserSettings(): void {
  const file = join(OVERRIDES, 'settings.json')
  if (existsSync(file)) unlinkSync(file)
}

function readdirSafe(dir: string): string[] {
  try { return readdirSync(dir).sort() } catch { return [] }
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
