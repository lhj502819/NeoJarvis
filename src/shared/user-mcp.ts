import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { resolveMcpServers } from '../auth/mcp-servers.js'

/**
 * 组装该用户所有 enabled 的 MCP servers，供 SDK 的 query() 使用。
 * 返回的字典键名 = 用户配置的 name（LLM 看到 <name>__<tool> 命名空间）。
 *
 * 无凭证/失败时返回 `{}`，让 query() 保持无 MCP 状态。
 */
export function buildUserMcpServers(userId: string): Record<string, McpServerConfig> {
  const servers = resolveMcpServers(userId)
  const out: Record<string, McpServerConfig> = {}
  for (const s of servers) {
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

// 从 env map 里挑出常见的鉴权字段组装成 HTTP headers
// 约定：env 里叫 `Authorization` 就直接透传；否则若有 `TOKEN` / `API_KEY` 用 Bearer 包一层
function buildAuthHeaders(env: Record<string, string>): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase() === 'authorization') headers['Authorization'] = v
    else if (k === 'TOKEN' || k === 'API_KEY') headers['Authorization'] = `Bearer ${v}`
    else headers[k] = v   // 其他透传（用户自定义 header 用）
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}
