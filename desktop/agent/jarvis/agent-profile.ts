import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/**
 * Agent Profile —— 可配置的「业务分工手册」(dev-avatar)。
 *
 * 三层来源：
 *   1. data/persona/agents/<name>/        用户覆盖(配置页写入，热生效)
 *   2. desktop/agent/config/defaults/agents/<name>/  仓库内置默认
 *
 * 与 persona.ts 的 system-prompt 覆盖是同一套思路；区别是这里按结构化字段拆开，
 * 便于配置页编辑，也便于分别渲染 Jarvis 视图与小弟视图。
 */

const AGENT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULTS_ROOT = join(AGENT_ROOT, 'config', 'defaults', 'agents')
// 测试可通过 JARVIS_PERSONA_AGENTS_DIR 指向临时目录，避免污染真实 data/
const OVERRIDES_ROOT = process.env.JARVIS_PERSONA_AGENTS_DIR
  || join(process.cwd(), 'data', 'persona', 'agents')

export const DEFAULT_AGENT_NAME = 'dev-avatar'
const TEXT_FIELDS = ['role', 'boundaries', 'redlines', 'workflow', 'taboos'] as const
const JARVIS_SECTION_MAX = 24_000
const WORKER_SECTION_MAX = 12_000

export interface AgentModule {
  id: string
  capability: string
  app: string
  repo: string
  entry: string
  triggers: string[]
  domain: string
}

export interface AgentProfile {
  name: string
  enabled: boolean
  title: string
  subtitle: string
  source: string
  domains: string[]
  modules: AgentModule[]
  role: string
  boundaries: string
  redlines: string
  workflow: string
  taboos: string
}

export interface AgentProfileState {
  profile: AgentProfile
  defaults: AgentProfile
  overridden: boolean
}

export interface AgentProfileAuditEntry {
  at: string
  source: 'config' | 'jarvis'
  action: 'update' | 'reset'
  changed: string[]
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export function isValidAgentName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name)
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

function readJson(path: string): Record<string, unknown> | null {
  const text = readText(path)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : undefined
}

function sanitizeModules(input: unknown, fallback: AgentModule[]): AgentModule[] {
  if (!Array.isArray(input)) return fallback
  const seen = new Set<string>()
  return input.map((raw, index) => {
    const m = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    let id = asString(m.id)?.trim() || `m${index + 1}`
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) id = `m${index + 1}-${Date.now().toString(36)}`
    seen.add(id)
    return {
      id,
      capability: asString(m.capability) ?? '',
      app: asString(m.app) ?? '',
      repo: asString(m.repo) ?? '',
      entry: asString(m.entry) ?? '',
      triggers: asStringArray(m.triggers) ?? [],
      domain: asString(m.domain) ?? '',
    }
  })
}

function readProfileDir(root: string, name: string): { profile: Partial<AgentProfile>; hasAny: boolean } {
  const dir = join(root, name)
  const json = readJson(join(dir, 'profile.json'))
  const texts: Record<string, string> = {}
  for (const field of TEXT_FIELDS) {
    const content = readText(join(dir, `${field}.md`))
    if (content !== null) texts[field] = content
  }
  const hasAny = json !== null || Object.keys(texts).length > 0
  return {
    hasAny,
    profile: {
      ...(asString(json?.name) !== undefined ? { name: asString(json?.name)! } : {}),
      ...(typeof json?.enabled === 'boolean' ? { enabled: json.enabled } : {}),
      ...(asString(json?.title) !== undefined ? { title: asString(json?.title)! } : {}),
      ...(asString(json?.subtitle) !== undefined ? { subtitle: asString(json?.subtitle)! } : {}),
      ...(asString(json?.source) !== undefined ? { source: asString(json?.source)! } : {}),
      ...(asStringArray(json?.domains) !== undefined ? { domains: asStringArray(json?.domains)! } : {}),
      ...(Array.isArray(json?.modules) ? { modules: sanitizeModules(json.modules, []) } : {}),
      ...texts,
    },
  }
}

function emptyProfile(name: string): AgentProfile {
  return {
    name,
    enabled: false,
    title: name,
    subtitle: '',
    source: 'builtin',
    domains: [],
    modules: [],
    role: '',
    boundaries: '',
    redlines: '',
    workflow: '',
    taboos: '',
  }
}

function mergeProfile(base: AgentProfile, override: Partial<AgentProfile>): AgentProfile {
  return {
    ...base,
    ...override,
    name: base.name,
    source: base.source,
    domains: override.domains ?? base.domains,
    modules: override.modules ?? base.modules,
  }
}

export function getAgentProfileState(name: string = DEFAULT_AGENT_NAME): AgentProfileState {
  if (!isValidAgentName(name)) throw new Error(`非法 agent 名称: ${name}`)
  const defaultsResult = readProfileDir(DEFAULTS_ROOT, name)
  const defaults = mergeProfile(emptyProfile(name), defaultsResult.profile)
  const overrideResult = readProfileDir(OVERRIDES_ROOT, name)
  const profile = mergeProfile(defaults, overrideResult.profile)
  return { profile, defaults, overridden: overrideResult.hasAny }
}

export function getAgentProfile(name: string = DEFAULT_AGENT_NAME): AgentProfile {
  return getAgentProfileState(name).profile
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

function modulesTable(profile: AgentProfile): string {
  if (profile.modules.length === 0) return '（暂未配置业务模块）'
  const head = '| 能力 | 应用 | 仓库 | 代码入口 | 触发词 | 默认 domain |\n| --- | --- | --- | --- | --- | --- |'
  const rows = profile.modules.map(m => `| ${escapeCell(m.capability)} | ${escapeCell(m.app)} | ${escapeCell(m.repo)} | ${escapeCell(m.entry)} | ${escapeCell(m.triggers.join('、'))} | ${escapeCell(m.domain)} |`)
  return [head, ...rows].join('\n')
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[...内容过长已截断，原始 ${text.length} 字符]`
}

/** Jarvis 本体注入：它需要完整分工、边界、红线和流程来判断与派单。 */
export function renderJarvisSection(name: string = DEFAULT_AGENT_NAME): string {
  const p = getAgentProfile(name)
  const section = `## 业务分工手册（${p.name} · ${p.enabled ? '默认启用' : '已停用'}）
以下内容用于判断任务归属、选择小弟和 domain；执行细节交给小弟。

### 角色定位
${p.role || '（未配置）'}

### 业务分工
${modulesTable(p)}

### 分工边界
${p.boundaries || '（未配置）'}

### 风险红线
${p.redlines || '（未配置）'}

### 执行流程
${p.workflow || '（未配置）'}

### 禁忌与汇报
${p.taboos || '（未配置）'}

派 PRD / TRD 任务时：按上表填 domain；需要在任务描述里保留模块、仓库和入口线索；把 skills 设为 ["${p.name}"]，让小弟加载完整执行手册。`
  return cap(section, JARVIS_SECTION_MAX)
}

/** 小弟注入：只放不可协商的硬约束，长流程走 skill。 */
export function renderWorkerConstraints(name: string = DEFAULT_AGENT_NAME): string {
  const p = getAgentProfile(name)
  const section = `## ${p.name} 硬约束（不可协商）
你正在执行 PRD / TRD 方向的任务。以下规则直接来自 Jarvis 配置，不依赖你的自觉。

### 分工边界
${p.boundaries || '（未配置）'}

### 风险红线
${p.redlines || '（未配置）'}

### 禁忌与汇报
${p.taboos || '（未配置）'}`
  return cap(section, WORKER_SECTION_MAX)
}

/** 完整执行手册：物化成 SKILL.md 给小弟按需读取。 */
export function renderSkillMarkdown(name: string = DEFAULT_AGENT_NAME): string {
  const p = getAgentProfile(name)
  const description = `${p.title}。定义 PRD / TRD 的业务分工、边界、红线与执行流程；Jarvis 派发对应任务时生效。`
  return `---
name: ${p.name}
description: ${description.replace(/\n/g, ' ')}
---

# ${p.title}

${p.subtitle}

## 角色定位
${p.role || '（未配置）'}

## 业务分工
${modulesTable(p)}

## 分工边界
${p.boundaries || '（未配置）'}

## 风险红线
${p.redlines || '（未配置）'}

## 执行流程
${p.workflow || '（未配置）'}

## 禁忌与汇报
${p.taboos || '（未配置）'}
`
}

/**
 * 把当前生效配置物化成 SKILL.md，返回包含该 skill 的目录。
 * 小弟派单时用 additionalSkillPaths / skillsOverride 挂载，内容随配置热更新。
 */
export function materializeAgentSkill(name: string = DEFAULT_AGENT_NAME): string | null {
  try {
    const dir = join(OVERRIDES_ROOT, name, '.rendered')
    const file = join(dir, 'SKILL.md')
    const content = renderSkillMarkdown(name)
    if (!existsSync(file) || readText(file) !== content) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, content, 'utf-8')
    }
    return dir
  } catch {
    return null
  }
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

const AUDIT_FIELDS = ['enabled', 'title', 'subtitle', 'domains', 'modules', 'role', 'boundaries', 'redlines', 'workflow', 'taboos'] as const

function auditPath(name: string): string {
  // 放在 agent 目录之外：恢复默认会删掉整个 agent 目录，审计要留下来
  return join(OVERRIDES_ROOT, `${name}.audit.jsonl`)
}

function pickFields(profile: AgentProfile, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) out[field] = (profile as unknown as Record<string, unknown>)[field]
  return out
}

function changedFields(before: AgentProfile, after: AgentProfile): string[] {
  return AUDIT_FIELDS.filter(field =>
    JSON.stringify((before as unknown as Record<string, unknown>)[field])
    !== JSON.stringify((after as unknown as Record<string, unknown>)[field]))
}

function appendAudit(name: string, entry: AgentProfileAuditEntry): void {
  try {
    const path = auditPath(name)
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch { /* 审计失败不影响配置写入 */ }
}

/** 最近变更记录（最新在前）。配置页 / Jarvis 都可以读取。 */
export function getAgentProfileAudit(name: string = DEFAULT_AGENT_NAME, limit = 20): AgentProfileAuditEntry[] {
  if (!isValidAgentName(name)) return []
  const text = readText(auditPath(name))
  if (!text) return []
  const entries: AgentProfileAuditEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && typeof parsed.at === 'string') {
        entries.push(parsed as AgentProfileAuditEntry)
      }
    } catch { /* 跳过损坏行 */ }
  }
  return entries.slice(-limit).reverse()
}

export function saveAgentProfile(
  name: string,
  input: unknown,
  source: 'config' | 'jarvis' = 'config',
): AgentProfileState {
  if (!isValidAgentName(name)) throw new Error(`非法 agent 名称: ${name}`)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('profile 必须是对象')
  }
  const raw = input as Record<string, unknown>
  const before = getAgentProfile(name)
  const { profile: defaults } = getAgentProfileState(name)
  const merged = mergeProfile(defaults, {
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(asString(raw.title) !== undefined ? { title: asString(raw.title)! } : {}),
    ...(asString(raw.subtitle) !== undefined ? { subtitle: asString(raw.subtitle)! } : {}),
    ...(asStringArray(raw.domains) !== undefined ? { domains: asStringArray(raw.domains)! } : {}),
    ...(Array.isArray(raw.modules) ? { modules: sanitizeModules(raw.modules, []) } : {}),
    role: asString(raw.role) ?? defaults.role,
    boundaries: asString(raw.boundaries) ?? defaults.boundaries,
    redlines: asString(raw.redlines) ?? defaults.redlines,
    workflow: asString(raw.workflow) ?? defaults.workflow,
    taboos: asString(raw.taboos) ?? defaults.taboos,
  })

  const dir = join(OVERRIDES_ROOT, name)
  writeText(join(dir, 'profile.json'), `${JSON.stringify({
    name: merged.name,
    enabled: merged.enabled,
    title: merged.title,
    subtitle: merged.subtitle,
    source: merged.source,
    domains: merged.domains,
    modules: merged.modules,
  }, null, 2)}\n`)

  for (const field of TEXT_FIELDS) {
    const content = merged[field]
    const path = join(dir, `${field}.md`)
    if (content.trim()) writeText(path, content)
    else if (existsSync(path)) rmSync(path)
  }

  materializeAgentSkill(name)

  const changed = changedFields(before, merged)
  if (changed.length > 0) {
    appendAudit(name, {
      at: new Date().toISOString(),
      source,
      action: 'update',
      changed,
      before: pickFields(before, changed),
      after: pickFields(merged, changed),
    })
  }
  return getAgentProfileState(name)
}

export function resetAgentProfile(
  name: string = DEFAULT_AGENT_NAME,
  source: 'config' | 'jarvis' = 'config',
): AgentProfileState {
  if (!isValidAgentName(name)) throw new Error(`非法 agent 名称: ${name}`)
  const before = getAgentProfile(name)
  rmSync(join(OVERRIDES_ROOT, name), { recursive: true, force: true })
  const after = getAgentProfile(name)
  appendAudit(name, {
    at: new Date().toISOString(),
    source,
    action: 'reset',
    changed: ['*'],
    before: { title: before.title, enabled: before.enabled, modules: before.modules.length },
    after: { title: after.title, enabled: after.enabled, modules: after.modules.length },
  })
  return getAgentProfileState(name)
}

export interface AgentRelevanceInput {
  domain?: string
  recipeDomain?: string
  description?: string
  skills?: string[]
  agentName?: string
}

/** 判断一个子任务是否属于这份业务分工。 */
export function isAgentRelevant(input: AgentRelevanceInput, name: string = DEFAULT_AGENT_NAME): boolean {
  const p = getAgentProfile(name)
  if (!p.enabled) return false
  if (input.skills?.includes(p.name)) return true

  const hay = [input.domain, input.recipeDomain, input.description, input.agentName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!hay.trim()) return false

  const keys = [
    p.name,
    p.title,
    ...p.domains,
    ...p.modules.flatMap(m => [m.capability, m.app, m.repo, m.entry, m.domain, ...m.triggers]),
  ]
  return keys.some(key => key && hay.includes(key.toLowerCase()))
}

/** 测试辅助：暴露当前覆盖根目录，便于断言与清理。 */
export const _internals = { OVERRIDES_ROOT, DEFAULTS_ROOT }
