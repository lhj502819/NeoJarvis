import { serverGet, serverPost } from '../shared/server-client.js'
import { listHubMcpServers, type HubMcpServer } from './mcp-hub.js'
import { resolveMcpServers } from '../auth/mcp-servers.js'

/**
 * MCP enable/disable preferences (sibling of skill-prefs.ts).
 *
 * 数据层走 Java server(GET /api/mcp/prefs 返回 {code:0, disabled:[]}、POST /api/mcp/{name}/toggle);
 * 扫本机 ~/.claude.json → listHubMcpServers() 仍在客户端(见 mcp-hub.ts),智能层负责合并 hub + DB user。
 */

// 管道类 MCP:Jarvis 内部机制(小弟↔Jarvis 通信),恒挂载、不进管理页、不受启禁影响。
// 与 llm.ts 的 'jarvis-system' / client.ts 的 'agent-comms' 保持隐式约定 —— 那些由调用方单独 prepend,
// 但如果这里的名字碰上,我们也不会当做"用户配的 MCP"计入。
export const PIPELINE_MCPS = ['agent-comms', 'jarvis-system']

export async function getDisabledMcps(userId: string): Promise<Set<string>> {
  try {
    // Java 返回 { code: 0, disabled: string[] };code 只是形式约定,TS 只关心 disabled。
    const { disabled } = await serverGet<{ code: number; disabled: string[] }>(userId, '/api/mcp/prefs')
    return new Set(disabled || [])
  } catch {
    // 不打日志避免路径/errno 顺带 dump;失败降级为"空黑名单",保持派单可用。
    return new Set()
  }
}

export async function setMcpEnabled(userId: string, name: string, enabled: boolean): Promise<void> {
  // Java 端 toggle 幂等处理启/禁(黑名单 upsert / delete),返回 {ok:true}。
  await serverPost(userId, `/api/mcp/${encodeURIComponent(name)}/toggle`, { enabled })
}

// 前端管理页/内部日志用的裁剪视图 —— envKeys 只列 key 名(不含 value),secret 不出智能层。
export interface McpView {
  name: string
  type: 'stdio' | 'sse' | 'http' | 'ws' | string
  source: 'personal' | 'user'
  enabled: boolean
  envKeys?: string[]
  command?: string
  args?: string[]
  url?: string
  description?: string
}

/**
 * 给管理页/UI 用:合并 hub(本机 ~/.claude.json) + DB(用户在 Jarvis 里自加的) + 启禁状态。
 *
 * 合并策略与 buildUserMcpServers 保持一致:同名时 DB user 覆盖 hub —— 用户明确配的凭证优先。
 * 排除 PIPELINE_MCPS(内部机制,不给 UI 看);envKeys 只回 key 名,永不回 value。
 */
export async function listMcpsForUser(userId: string): Promise<McpView[]> {
  const disabled = await getDisabledMcps(userId)
  const hub = listHubMcpServers()
  const dbServers = await resolveMcpServers(userId).catch(() => [])

  const merged = new Map<string, McpView>()

  for (const s of hub) {
    if (PIPELINE_MCPS.includes(s.name)) continue
    merged.set(s.name, {
      name: s.name,
      type: s.type,
      source: 'personal',
      enabled: !disabled.has(s.name),
      envKeys: s.env && Object.keys(s.env).length ? Object.keys(s.env) : undefined,
      command: s.command,
      args: s.args,
      url: s.url,
    })
  }

  for (const s of dbServers) {
    if (PIPELINE_MCPS.includes(s.name)) continue
    const envKeys = s.env && Object.keys(s.env).length ? Object.keys(s.env) : undefined
    merged.set(s.name, {
      name: s.name,
      type: s.transport,
      source: 'user',
      enabled: !disabled.has(s.name),
      envKeys,
      command: s.command,
      args: s.args,
      url: s.url,
      description: s.description,
    })
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// 仅用于测试注入 / 内部工具:HubMcpServer 视图直接暴露给单测,不用于生产代码路径。
export type { HubMcpServer }
