import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { resolveMcpServers } from '../auth/mcp-servers.js'
import { listHubMcpServers, type HubMcpServer } from '../jarvis/mcp-hub.js'
import { getDisabledMcps, PIPELINE_MCPS } from '../jarvis/mcp-prefs.js'

/**
 * 组装该用户所有启用的 MCP servers,供 SDK 的 query() 使用。
 * 返回的字典键名 = MCP 名(LLM 看到 <name>__<tool> 命名空间)。
 *
 * 三来源合并:
 *   1. 本机 hub —— `~/.claude.json` 的 mcpServers 段,通过 mcp-hub.ts 读入
 *   2. DB user —— Jarvis 里"用户自加"的,通过 Java `/api/mcp-servers/resolved` 拿到解密后的 env
 *   3. 黑名单 —— Java `/api/mcp/prefs`,启禁开关
 *
 * 合并策略:
 *   - 先加 hub,再加 DB user;同名时 DB user 覆盖 hub —— 用户明确在 Jarvis 里配的凭证优先
 *     (相比 ~/.claude.json 的本机默认,DB 里存的往往是用户按 Jarvis 场景专门配的)
 *   - 黑名单中的 name 双侧都跳过
 *   - PIPELINE_MCPS 在这里不处理 —— 内部管道 MCP(agent-comms / jarvis-system)由调用方 llm.ts /
 *     client.ts 单独 prepend,恒挂载且不受启禁影响
 *
 * secret:hub 与 DB 的 env 只在这个函数返回的字典里流转,喂给 SDK 后随子进程消费,
 * 不入 Java DB(hub 侧)、不打日志、不回前端。
 *
 * 失败降级:hub 读失败返空数组,DB resolve 失败返空,黑名单读失败当作空 —— 任一环节挂了不影响其他来源。
 */
export async function buildUserMcpServers(userId: string): Promise<Record<string, McpServerConfig>> {
  const [hub, dbServers, disabled] = await Promise.all([
    Promise.resolve(safeListHub()),
    resolveMcpServers(userId).catch(() => []),
    getDisabledMcps(userId),
  ])

  const out: Record<string, McpServerConfig> = {}

  for (const s of hub) {
    if (disabled.has(s.name)) continue
    if (PIPELINE_MCPS.includes(s.name)) continue
    const cfg = hubToSdkConfig(s)
    if (cfg) out[s.name] = cfg
  }

  // DB user 后加 —— 同名覆盖 hub(用户显式配置优先)
  for (const s of dbServers) {
    if (disabled.has(s.name)) continue
    if (PIPELINE_MCPS.includes(s.name)) continue
    if (s.transport === 'stdio') {
      if (!s.command) continue
      out[s.name] = {
        type: 'stdio',
        command: s.command,
        args: s.args,
        env: s.env,
      }
    } else if (s.transport === 'sse') {
      if (!s.url) continue
      out[s.name] = {
        type: 'sse',
        url: s.url,
        headers: buildAuthHeaders(s.env),
      }
    } else if (s.transport === 'http') {
      if (!s.url) continue
      out[s.name] = {
        type: 'http',
        url: s.url,
        headers: buildAuthHeaders(s.env),
      }
    }
  }

  return out
}

function safeListHub(): HubMcpServer[] {
  try {
    return listHubMcpServers()
  } catch {
    // 不打日志:文件可能含 secret,失败也不能顺带 dump。
    return []
  }
}

// hub 条目 → SDK McpServerConfig
// hub 的 type 是已经归一化过的('stdio'/'sse'/'http'/'ws'),字段就位;这里只是格式转换,不做二次校验。
function hubToSdkConfig(s: HubMcpServer): McpServerConfig | null {
  if (s.type === 'stdio') {
    if (!s.command) return null
    return {
      type: 'stdio',
      command: s.command,
      args: s.args,
      env: s.env,
    }
  }
  if (s.type === 'sse') {
    if (!s.url) return null
    return {
      type: 'sse',
      url: s.url,
      headers: buildAuthHeaders(s.env || {}),
    }
  }
  if (s.type === 'http') {
    if (!s.url) return null
    return {
      type: 'http',
      url: s.url,
      headers: buildAuthHeaders(s.env || {}),
    }
  }
  // 'ws' 或未知类型:SDK 当前 McpServerConfig 类型不包含 ws,跳过。
  return null
}

// 从 env map 里挑出常见的鉴权字段组装成 HTTP headers
// 约定:env 里叫 `Authorization` 就直接透传;否则若有 `TOKEN` / `API_KEY` 用 Bearer 包一层
function buildAuthHeaders(env: Record<string, string>): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase() === 'authorization') headers['Authorization'] = v
    else if (k === 'TOKEN' || k === 'API_KEY') headers['Authorization'] = `Bearer ${v}`
    else headers[k] = v // 其他透传(用户自定义 header 用)
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}
