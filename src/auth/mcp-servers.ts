import { serverGet, serverPost, serverPut, serverDelete } from '../shared/server-client.js'

export type Transport = 'stdio' | 'sse' | 'http'

export interface McpServer {
  id: string
  userId: string
  name: string
  transport: Transport
  command?: string
  args?: string[]
  url?: string
  envKeys: string[]        // 脱敏：只回 env 的 key 名，不回值
  description?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedMcpServer {
  name: string
  transport: Transport
  command?: string
  args?: string[]
  url?: string
  env: Record<string, string>   // 解密后的完整 env
  description?: string
}

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

// 脱敏列表（env 只回 key 名,不回值)—— Java list 已裁掉 env 明文,只回 envKeys
export async function listMcpServers(userId: string): Promise<McpServer[]> {
  return serverGet<McpServer[]>(userId, '/api/mcp-servers')
}

// 解密解析全部 enabled server，用于组装 SDK mcpServers 字典（仅后端）。
// 命中 Java 内部 resolve 端点（返回解密后的完整 env）；无 enabled server 时返回 []。
// 解密失败的 server 已在 Java 侧告警并跳过（不打印明文 env），与老 TS 的 warn + continue 语义一致。
export async function resolveMcpServers(userId: string): Promise<ResolvedMcpServer[]> {
  return serverGet<ResolvedMcpServer[]>(userId, '/api/mcp-servers/resolved')
}

export async function addMcpServer(userId: string, p: {
  name: string
  transport: Transport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  description?: string
}): Promise<McpServer> {
  // 校验（stdio 需 command;sse/http 需 url)在 Java service 侧执行,失败时抛 400。
  return serverPost<McpServer>(userId, '/api/mcp-servers', p)
}

export async function updateMcpServer(userId: string, name: string, p: {
  transport?: Transport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>   // 传了就整体替换（不合并旧值）
  description?: string
  enabled?: boolean
}): Promise<McpServer | null> {
  // Java 是 PUT /api/mcp-servers/{name};缺失时抛 404 → 映射为 null(老 TS 的 rows[0] ? ... : null)。
  try {
    return await serverPut<McpServer>(userId, `/api/mcp-servers/${encodeURIComponent(name)}`, p)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function removeMcpServer(userId: string, name: string): Promise<boolean> {
  // Java DELETE 返回 {ok:true},缺失时抛 404 → 映射为 false(老 TS 的 boolean 语义)。
  try {
    const res = await serverDelete<{ ok: boolean }>(userId, `/api/mcp-servers/${encodeURIComponent(name)}`)
    return res?.ok === true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}
