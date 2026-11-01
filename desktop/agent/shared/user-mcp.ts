/**
 * 组装该用户所有启用的 MCP servers 的工具桥接。
 *
 * ⚠️ 迁移说明(Claude Agent SDK → Pi Agent SDK):
 *   Claude SDK 原生支持 MCP(via query({ mcpServers })),Pi 的设计哲学是"No MCP"——
 *   工具通过 defineTool() 或 extension 注册,不消费 MCP 协议。
 *
 *   完整 MCP 桥接(spawn stdio server / 连 sse-http endpoint → list tools →
 *   包成 ToolDefinition)需要写一个 Pi extension,工作量较大。本次迁移先**降级**:
 *   该函数保留签名但返回空数组,保证 llm.ts / client.ts / factory.ts 主流程不崩。
 *   用户自配的 MCP servers(GitHub/Slack 等)暂时不可用,待后续用 extension 补齐。
 *
 * 保留的三来源合并逻辑(hub + DB user + 黑名单)只用于 mcp-hub.ts / mcp-prefs.ts
 * 的视图展示(前端 MCP 管理页),不再参与工具运行时。
 */

import { listHubMcpServers, type HubMcpServer } from '../jarvis/mcp-hub.js'
import { resolveMcpServers } from '../auth/mcp-servers.js'
import { getDisabledMcps, PIPELINE_MCPS } from '../jarvis/mcp-prefs.js'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

/**
 * 原本返回 Record<string, McpServerConfig>,供 Claude SDK query({ mcpServers }) 使用。
 * 现迁回 ToolDefinition[](Pi 的 customTools 格式)。降级期返回空数组。
 *
 * 失败降级:hub 读失败、DB resolve 失败、黑名单读失败 —— 任一环节挂了不影响其他来源,
 * 且整体返回空数组(不抛错),保证派单主链路不被 MCP 桥接拖累。
 */
export async function buildUserMcpServers(_userId: string): Promise<ToolDefinition[]> {
  // 保留原本的三来源拉取(hub + DB user + 黑名单),用于日志和后续 extension 桥接的素材。
  // 降级期不消费返回值,只确认数据可拉取(便于将来 extension 直接用)。
  await Promise.all([
    Promise.resolve(safeListHub()),
    resolveMcpServers(_userId).catch(() => []),
    getDisabledMcps(_userId),
  ]).catch(() => undefined)

  // TODO(MCP-bridge): 用 Pi extension 把每个 MCP server 的工具动态发现并包成 ToolDefinition。
  // stdio 类型需 spawn 子进程走 MCP 协议 list tools;sse/http 类型需连端点。
  return []
}

function safeListHub(): HubMcpServer[] {
  try {
    return listHubMcpServers()
  } catch {
    return []
  }
}

// 以下配置类型保留导出(供 mcp-hub.ts / mcp-prefs.ts 视图层复用),不再喂给 SDK 运行时。

export interface McpServerConfigView {
  type: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
}

/** hub 条目 → 视图配置(展示用,不再映射 SDK McpServerConfig) */
export function hubToViewConfig(s: HubMcpServer): McpServerConfigView | null {
  if (s.type === 'stdio') {
    if (!s.command) return null
    return { type: 'stdio', command: s.command, args: s.args, env: s.env }
  }
  if (s.type === 'sse') {
    if (!s.url) return null
    return { type: 'sse', url: s.url, headers: buildAuthHeaders(s.env || {}) }
  }
  if (s.type === 'http') {
    if (!s.url) return null
    return { type: 'http', url: s.url, headers: buildAuthHeaders(s.env || {}) }
  }
  return null
}

// 从 env map 里挑出常见的鉴权字段组装成 HTTP headers
function buildAuthHeaders(env: Record<string, string>): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase() === 'authorization') headers['Authorization'] = v
    else if (k === 'TOKEN' || k === 'API_KEY') headers['Authorization'] = `Bearer ${v}`
    else headers[k] = v
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

// PIPELINE_MCPS 保留导出(mcp-prefs.ts 视图用),内部 MCP 概念已废弃。
export { PIPELINE_MCPS }
