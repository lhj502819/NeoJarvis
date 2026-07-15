import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * MCP-Hub —— 对称 skills-hub.ts 的 listHubSkills:纯读、无副作用。
 *
 * 读用户本机 Claude Code 的 `~/.claude.json` 的 `mcpServers` 段,
 * 把每个条目转成 HubMcpServer,供 Jarvis "本机 MCP 汇总"用。
 *
 * 何时被调用:
 * - 未来 buildUserMcpServers 会调 listHubMcpServers() 拿本机 MCP 池,
 *   与 DB 里"Jarvis 自加"的 MCP 合并,再过黑名单,喂给 SDK options.mcpServers。
 * - 前端 MCP 管理页(McpPage)也会通过 TS 智能层的 GET /api/mcp/hub 读它。
 *
 * 与 skills-hub 的对称关系:
 * - skills-hub 需要软链目录(SKILL.md 是文件),这里 MCP 就是 JSON,直接读即可。
 * - skills-hub 有 syncSkillsHub()(有副作用),这里只需 listHubMcpServers() 纯读。
 *
 * 安全:env 值可能含 API key,禁止打印/落日志/回前端。
 */

export interface HubMcpServer {
  name: string
  type: 'stdio' | 'sse' | 'http' | 'ws'
  command?: string          // stdio
  args?: string[]           // stdio
  url?: string              // sse/http/ws
  env?: Record<string, string>
  source: 'personal'        // 本机 Claude 配的 = 个人;未来若 Codex 也扫可能有其他源
}

// 默认配置路径:用户本机 Claude Code 的 ~/.claude.json
function defaultConfigPath(): string {
  return join(homedir(), '.claude.json')
}

/**
 * 读并解析 Claude Code 配置文件。任何失败(不存在/坏 JSON/权限)都返回 null,不抛。
 * 独立导出用于测试注入。
 */
export function readClaudeMcpConfig(path: string = defaultConfigPath()): unknown {
  try {
    if (!existsSync(path)) return null
    const text = readFileSync(path, 'utf-8')
    return JSON.parse(text)
  } catch {
    // 不打日志:文件可能含 secret,失败也不能顺带把内容 dump 出来
    return null
  }
}

// 简单类型判定:普通对象(排除 null / 数组)
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// 从原始 entry 解析出 HubMcpServer,若无效返回 null(调用方跳过)
function normalizeEntry(name: string, raw: unknown): HubMcpServer | null {
  if (!isPlainObject(raw)) return null

  // type 兼容缺失:老配置只写 command 视为 stdio;只写 url 视为 sse
  const rawType = typeof raw.type === 'string' ? raw.type : undefined
  const hasCommand = typeof raw.command === 'string' && raw.command.length > 0
  const hasUrl = typeof raw.url === 'string' && raw.url.length > 0
  let type: HubMcpServer['type'] | undefined
  if (rawType === 'stdio' || rawType === 'sse' || rawType === 'http' || rawType === 'ws') {
    type = rawType
  } else if (!rawType) {
    if (hasCommand) type = 'stdio'
    else if (hasUrl) type = 'sse'
  }
  if (!type) return null

  // 无效条目过滤:stdio 无 command;sse/http/ws 无 url
  if (type === 'stdio' && !hasCommand) return null
  if ((type === 'sse' || type === 'http' || type === 'ws') && !hasUrl) return null

  const out: HubMcpServer = { name, type, source: 'personal' }

  if (type === 'stdio') {
    out.command = raw.command as string
    if (Array.isArray(raw.args)) {
      // 只保留字符串 args(防止误配数字/对象)
      out.args = (raw.args as unknown[]).filter((x): x is string => typeof x === 'string')
    }
  } else {
    out.url = raw.url as string
  }

  // env 是可选;只在存在且为对象时携带
  if (isPlainObject(raw.env)) {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.env)) {
      if (typeof v === 'string') env[k] = v
    }
    if (Object.keys(env).length > 0) out.env = env
  }

  return out
}

/**
 * 读用户本机 ~/.claude.json 的 mcpServers 段,返回列表。
 * 失败/文件不存在/无 mcpServers 段 → 返回空数组(不抛)。
 * 默认读 ~/.claude.json;测试可通过环境变量 JARVIS_HUB_MCP_CONFIG 或直接调 readClaudeMcpConfig 注入。
 * 返回结果按 name 排序,便于稳定 UI/日志。
 */
export function listHubMcpServers(): HubMcpServer[] {
  const overridePath = process.env.JARVIS_HUB_MCP_CONFIG
  const data = readClaudeMcpConfig(overridePath || defaultConfigPath())
  if (!isPlainObject(data)) return []

  const mcps = (data as Record<string, unknown>).mcpServers
  if (!isPlainObject(mcps)) return []

  const out: HubMcpServer[] = []
  for (const [name, raw] of Object.entries(mcps)) {
    const item = normalizeEntry(name, raw)
    if (item) out.push(item)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
