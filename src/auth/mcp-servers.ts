import { randomUUID } from 'crypto'
import db from '../shared/db.js'
import { encrypt, decrypt } from '../shared/crypto.js'

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

function rowToServer(row: any): McpServer {
  let envKeys: string[] = []
  if (row.env_enc) {
    try {
      const decrypted = decrypt(row.env_enc)
      const parsed = JSON.parse(decrypted) as Record<string, string>
      envKeys = Object.keys(parsed)
    } catch {
      envKeys = []
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    transport: row.transport,
    command: row.command || undefined,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    url: row.url || undefined,
    envKeys,
    description: row.description || undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 脱敏列表（env 只回 key 名，不回值）
export function listMcpServers(userId: string): McpServer[] {
  const rows = db.prepare(
    'SELECT * FROM jarvis_user_mcp_servers WHERE user_id = ? ORDER BY created_at ASC'
  ).all(userId) as any[]
  return rows.map(rowToServer)
}

// 解密解析全部 enabled server，用于组装 SDK mcpServers 字典（仅后端）
export function resolveMcpServers(userId: string): ResolvedMcpServer[] {
  const rows = db.prepare(
    'SELECT * FROM jarvis_user_mcp_servers WHERE user_id = ? AND enabled = 1'
  ).all(userId) as any[]
  const out: ResolvedMcpServer[] = []
  for (const row of rows) {
    let env: Record<string, string> = {}
    if (row.env_enc) {
      try {
        env = JSON.parse(decrypt(row.env_enc)) as Record<string, string>
      } catch {
        console.warn(`[mcp-servers] 解密失败 name=${row.name}，跳过`)
        continue
      }
    }
    out.push({
      name: row.name,
      transport: row.transport,
      command: row.command || undefined,
      args: row.args_json ? JSON.parse(row.args_json) : undefined,
      url: row.url || undefined,
      env,
      description: row.description || undefined,
    })
  }
  return out
}

export function addMcpServer(userId: string, p: {
  name: string
  transport: Transport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  description?: string
}): McpServer {
  // 校验：stdio 必须有 command；sse/http 必须有 url
  if (p.transport === 'stdio' && !p.command) throw new Error('stdio 类型必须提供 command')
  if ((p.transport === 'sse' || p.transport === 'http') && !p.url) throw new Error(`${p.transport} 类型必须提供 url`)

  const now = new Date().toISOString()
  const id = randomUUID()
  const envEnc = p.env && Object.keys(p.env).length > 0 ? encrypt(JSON.stringify(p.env)) : null
  const argsJson = p.args && p.args.length > 0 ? JSON.stringify(p.args) : null

  db.prepare(`
    INSERT INTO jarvis_user_mcp_servers (id, user_id, name, transport, command, args_json, url, env_enc, description, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, userId, p.name, p.transport, p.command || null, argsJson, p.url || null, envEnc, p.description || null, now, now)

  return rowToServer(db.prepare('SELECT * FROM jarvis_user_mcp_servers WHERE id = ?').get(id))
}

export function updateMcpServer(userId: string, name: string, p: {
  transport?: Transport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>   // 传了就整体替换（不合并旧值）
  description?: string
  enabled?: boolean
}): McpServer | null {
  const row = db.prepare('SELECT * FROM jarvis_user_mcp_servers WHERE user_id = ? AND name = ?').get(userId, name) as any
  if (!row) return null

  const now = new Date().toISOString()
  const envEnc = p.env !== undefined
    ? (Object.keys(p.env).length > 0 ? encrypt(JSON.stringify(p.env)) : null)
    : row.env_enc
  const argsJson = p.args !== undefined
    ? (p.args.length > 0 ? JSON.stringify(p.args) : null)
    : row.args_json

  db.prepare(`
    UPDATE jarvis_user_mcp_servers
    SET transport = ?, command = ?, args_json = ?, url = ?, env_enc = ?, description = ?, enabled = ?, updated_at = ?
    WHERE user_id = ? AND name = ?
  `).run(
    p.transport ?? row.transport,
    p.command ?? row.command,
    argsJson,
    p.url ?? row.url,
    envEnc,
    p.description ?? row.description,
    p.enabled !== undefined ? (p.enabled ? 1 : 0) : row.enabled,
    now, userId, name
  )
  return rowToServer(db.prepare('SELECT * FROM jarvis_user_mcp_servers WHERE user_id = ? AND name = ?').get(userId, name))
}

export function removeMcpServer(userId: string, name: string): boolean {
  const result = db.prepare('DELETE FROM jarvis_user_mcp_servers WHERE user_id = ? AND name = ?').run(userId, name)
  return result.changes > 0
}
