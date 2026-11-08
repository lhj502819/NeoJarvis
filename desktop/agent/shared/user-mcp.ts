/**
 * 组装该用户所有启用的 MCP servers 的工具桥接(P6 基建,原 Pi 迁移降级已补齐)。
 *
 * Pi 的设计哲学是"No MCP"——工具必须是 ToolDefinition(defineTool)。
 * 本模块做 MCP↔Pi 桥接:对每个启用的 stdio server 取共享客户端(mcp-stdio.ts,
 * 进程级复用+空闲回收),tools/list 把每个 MCP 工具包成 defineTool,
 * execute 转发 tools/call;名字加 mcp_<server>_ 前缀防撞。
 *
 * 三来源(同名 DB user 覆盖 hub,黑名单兜底):
 *   1. hub —— 本机 Claude Code 的 ~/.claude.json mcpServers
 *   2. DB user —— 配置页自配(env 加密存 Java 侧,resolve 换明文)
 *   3. 黑名单 —— mcp-prefs 启停
 *
 * 失败降级:任一 server 挂了(启动失败/协议错)只丢它自己的工具并告警日志,
 * 不影响其他 server,更不抛错 —— 派单主链路绝不被 MCP 拖累。
 * sse/http 传输 v1 未接(配置里占多数的 JD 网关后续一批),命中即日志跳过。
 */

import { listHubMcpServers, type HubMcpServer } from '../jarvis/mcp-hub.js'
import { resolveMcpServers } from '../auth/mcp-servers.js'
import { getDisabledMcps, PIPELINE_MCPS } from '../jarvis/mcp-prefs.js'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { retainMcpClient, type McpStdioClient } from './mcp-stdio.js'

interface NormalizedServer {
  name: string
  type: 'stdio' | 'sse' | 'http' | 'ws'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export async function buildUserMcpServers(userId: string): Promise<ToolDefinition[]> {
  // 三来源:同名时 DB user 覆盖 hub(用户明确配的凭证优先,与 mcp-prefs 合并策略一致)
  const [hubServers, userServers, disabled] = await Promise.all([
    Promise.resolve(safeListHub()).catch(() => [] as HubMcpServer[]),
    resolveMcpServers(userId).catch(() => []),
    getDisabledMcps(userId).catch(() => new Set<string>()),
  ])

  const byName = new Map<string, NormalizedServer>()
  for (const h of hubServers) {
    byName.set(h.name, { name: h.name, type: h.type, command: h.command, args: h.args, url: h.url, env: h.env })
  }
  for (const u of userServers) {
    byName.set(u.name, { name: u.name, type: u.transport, command: u.command, args: u.args, url: u.url, env: u.env })
  }

  const tools: ToolDefinition[] = []
  for (const server of byName.values()) {
    if (disabled.has(server.name) || PIPELINE_MCPS.includes(server.name)) continue
    try {
      if (server.type === 'stdio') {
        if (!server.command) continue
        // 命中分支后 command 已收窄为 string,断言只是帮 TS 越过联合类型的窄化边界
        tools.push(...await bridgeStdioServer(server as NormalizedServer & { command: string }))
      } else {
        // sse/http/ws 传输 v1 未接:到这一步的 server 逐个跳过,不拖累其他
        console.log(`[mcp] 跳过 ${server.type} 型 server「${server.name}」(传输桥接待后续批次)`)
      }
    } catch (err) {
      console.error(`[mcp] server「${server.name}」桥接失败,跳过: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (tools.length > 0) console.log(`[mcp] 桥接完成: ${tools.length} 个工具可用(${byName.size} 个 server)`)
  return tools
}

/**
 * 每 server 一个代理工具(Inline&Spill 在工具层的应用):13 个 server 直通映射会注入
 * 100+ 个工具 schema(每请求 ~15k token 常驻),代理式只要 13 个 —— 调用时不传 tool
 * 即返回该 server 的工具清单(带描述),选中后再带 tool+arguments 执行。
 */
async function bridgeStdioServer(server: NormalizedServer & { command: string }): Promise<ToolDefinition[]> {
  const client: McpStdioClient = retainMcpClient({
    name: server.name, command: server.command, args: server.args, env: server.env,
  })
  // 预热:启动即拉一次工具清单,失败在此暴露(调用期只剩 tools/call)
  const infos = await client.listTools()
  const catalog = infos.map(i => `- ${i.name}: ${(i.description ?? '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')

  return [defineTool({
    name: `mcp_${sanitize(server.name)}`,
    label: `MCP ${server.name}`,
    description: `[MCP:${server.name}] 代理入口。先不传 tool 调一次拿到该 server 的工具清单,再用 tool+arguments 执行具体工具。`,
    parameters: Type.Object({
      tool: Type.Optional(Type.String({ description: '要执行的工具名(第一次调用留空 = 只列清单)' })),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: '工具入参(按清单里各工具的 inputSchema 给)' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        if (!params.tool) {
          return { content: [{ type: 'text', text: `${server.name} 可用工具:\n${catalog || '(server 未提供工具)'}` }], details: {} }
        }
        const result = await client.callTool(params.tool, (params.arguments ?? {}) as Record<string, unknown>)
        return { content: [{ type: 'text', text: result.text || '(空结果)' }], details: {} }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `MCP 调用失败:${msg}` }], details: {} }
      }
    },
  })]
}

/** 工具名只允许 [a-zA-Z0-9_](Pi 侧模型调用约束),其余压成 _ */
function sanitize(name: string): string {
  return String(name ?? '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '') || 'srv'
}

function safeListHub(): HubMcpServer[] {
  try {
    return listHubMcpServers()
  } catch {
    return []
  }
}

// 以下配置类型保留导出(供 mcp-hub.ts / mcp-prefs.ts 视图层复用)。

export interface McpServerConfigView {
  type: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
}

/** hub 条目 → 视图配置(展示用) */
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

// PIPELINE_MCPS 保留导出(mcp-prefs.ts 视图用)
export { PIPELINE_MCPS }
