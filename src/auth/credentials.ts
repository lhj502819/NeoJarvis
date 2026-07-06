import { randomUUID } from 'crypto'
import db from '../shared/db.js'
import { encrypt, decrypt } from '../shared/crypto.js'

export interface Credential {
  id: string
  userId: string
  label: string
  tier: string
  baseUrl: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedCredential {
  apiKey: string
  baseUrl: string
  model: string
}

function rowToCredential(row: any): Credential {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    tier: row.tier,
    baseUrl: row.base_url,
    model: row.model,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 脱敏列表：绝不含 api_key
export function listCredentials(userId: string): Credential[] {
  const rows = db.prepare(
    'SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE user_id = ? ORDER BY created_at ASC'
  ).all(userId) as any[]
  return rows.map(rowToCredential)
}

// 解密解析，仅后端内部使用
export function resolveCredential(userId: string, tier?: string): ResolvedCredential | null {
  let row: any
  if (tier) {
    // 指定 tier：该 tier 默认优先，否则该 tier 任意一个
    row = db.prepare(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = ? AND tier = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
    ).get(userId, tier)
  }
  if (!row) {
    // 无 tier 或无匹配 → 用户默认凭证
    row = db.prepare(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
    ).get(userId)
  }
  if (!row) return null
  try {
    return { apiKey: decrypt(row.api_key_enc), baseUrl: row.base_url, model: row.model }
  } catch {
    console.warn(`[credentials] resolveCredential: 解密失败，userId=${userId}，凭证已损坏或密钥已轮换，回退到平台默认 key`)
    return null
  }
}

function clearDefault(userId: string) {
  db.prepare('UPDATE jarvis_user_credentials SET is_default = 0 WHERE user_id = ?').run(userId)
}

export function addCredential(userId: string, p: {
  label: string; tier: string; apiKey: string; baseUrl: string; model: string; isDefault?: boolean
}): Credential {
  const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM jarvis_user_credentials WHERE user_id = ?').get(userId) as any).cnt
  // 第一个凭证强制为默认；或显式要求默认
  const makeDefault = p.isDefault || existingCount === 0
  if (makeDefault) clearDefault(userId)

  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO jarvis_user_credentials (id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, p.label, p.tier, encrypt(p.apiKey), p.baseUrl, p.model, makeDefault ? 1 : 0, now, now)

  return rowToCredential(db.prepare('SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE id = ?').get(id))
}

export function updateCredential(userId: string, id: string, p: {
  label?: string; tier?: string; apiKey?: string; baseUrl?: string; model?: string; isDefault?: boolean
}): Credential | null {
  const row = db.prepare('SELECT * FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!row) return null

  if (p.isDefault === true) clearDefault(userId)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE jarvis_user_credentials
    SET label = ?, tier = ?, api_key_enc = ?, base_url = ?, model = ?, is_default = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    p.label ?? row.label,
    p.tier ?? row.tier,
    p.apiKey !== undefined ? encrypt(p.apiKey) : row.api_key_enc,  // apiKey 未传则保留原值
    p.baseUrl ?? row.base_url,
    p.model ?? row.model,
    p.isDefault === true ? 1 : row.is_default,
    now, id, userId
  )
  return rowToCredential(db.prepare('SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE id = ?').get(id))
}

export function deleteCredential(userId: string, id: string): boolean {
  const row = db.prepare('SELECT is_default FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!row) return false
  db.prepare('DELETE FROM jarvis_user_credentials WHERE id = ? AND user_id = ?').run(id, userId)

  // 删的是默认且还有其它凭证 → 自动指定最早创建的为新默认
  if (row.is_default === 1) {
    const next = db.prepare('SELECT id FROM jarvis_user_credentials WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(userId) as any
    if (next) db.prepare('UPDATE jarvis_user_credentials SET is_default = 1 WHERE id = ? AND user_id = ?').run(next.id, userId)
  }
  return true
}
