import { randomUUID } from 'crypto'
import pool from '../shared/db.js'
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
    isDefault: row.is_default === 1 || row.is_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 脱敏列表：绝不含 api_key
export async function listCredentials(userId: string): Promise<Credential[]> {
  const { rows } = await pool.query(
    'SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  )
  return rows.map(rowToCredential)
}

// 解密解析，仅后端内部使用
export async function resolveCredential(userId: string, tier?: string): Promise<ResolvedCredential | null> {
  let row: any
  if (tier) {
    // 指定 tier：该 tier 默认优先，否则该 tier 任意一个
    const { rows } = await pool.query(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = $1 AND tier = $2 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      [userId, tier]
    )
    row = rows[0]
  }
  if (!row) {
    // 无 tier 或无匹配 → 用户默认凭证
    const { rows } = await pool.query(
      'SELECT * FROM jarvis_user_credentials WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      [userId]
    )
    row = rows[0]
  }
  if (!row) return null
  try {
    return { apiKey: decrypt(row.api_key_enc), baseUrl: row.base_url, model: row.model }
  } catch {
    console.warn(`[credentials] resolveCredential: 解密失败，userId=${userId}，凭证已损坏或密钥已轮换，回退到平台默认 key`)
    return null
  }
}

async function clearDefault(userId: string) {
  await pool.query('UPDATE jarvis_user_credentials SET is_default = 0 WHERE user_id = $1', [userId])
}

export async function addCredential(userId: string, p: {
  label: string; tier: string; apiKey: string; baseUrl: string; model: string; isDefault?: boolean
}): Promise<Credential> {
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) as cnt FROM jarvis_user_credentials WHERE user_id = $1',
    [userId]
  )
  const existingCount = parseInt(countRows[0].cnt, 10)
  // 第一个凭证强制为默认；或显式要求默认
  const makeDefault = p.isDefault || existingCount === 0
  if (makeDefault) await clearDefault(userId)

  const now = new Date().toISOString()
  const id = randomUUID()
  await pool.query(`
    INSERT INTO jarvis_user_credentials (id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [id, userId, p.label, p.tier, encrypt(p.apiKey), p.baseUrl, p.model, makeDefault ? 1 : 0, now, now])

  const { rows } = await pool.query(
    'SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE id = $1',
    [id]
  )
  return rowToCredential(rows[0])
}

export async function updateCredential(userId: string, id: string, p: {
  label?: string; tier?: string; apiKey?: string; baseUrl?: string; model?: string; isDefault?: boolean
}): Promise<Credential | null> {
  const { rows: existingRows } = await pool.query(
    'SELECT * FROM jarvis_user_credentials WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  const row = existingRows[0]
  if (!row) return null

  if (p.isDefault === true) await clearDefault(userId)

  const now = new Date().toISOString()
  await pool.query(`
    UPDATE jarvis_user_credentials
    SET label = $1, tier = $2, api_key_enc = $3, base_url = $4, model = $5, is_default = $6, updated_at = $7
    WHERE id = $8 AND user_id = $9
  `, [
    p.label ?? row.label,
    p.tier ?? row.tier,
    p.apiKey ? encrypt(p.apiKey) : row.api_key_enc,  // 空串与 undefined 都视为"不更新"，防止空串覆盖真实 key
    p.baseUrl ?? row.base_url,
    p.model ?? row.model,
    p.isDefault === true ? 1 : row.is_default,
    now, id, userId
  ])

  const { rows } = await pool.query(
    'SELECT id, user_id, label, tier, base_url, model, is_default, created_at, updated_at FROM jarvis_user_credentials WHERE id = $1',
    [id]
  )
  return rowToCredential(rows[0])
}

export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  const { rows: existingRows } = await pool.query(
    'SELECT is_default FROM jarvis_user_credentials WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  const row = existingRows[0]
  if (!row) return false
  await pool.query('DELETE FROM jarvis_user_credentials WHERE id = $1 AND user_id = $2', [id, userId])

  // 删的是默认且还有其它凭证 → 自动指定最早创建的为新默认
  if (row.is_default === 1 || row.is_default === true) {
    const { rows: nextRows } = await pool.query(
      'SELECT id FROM jarvis_user_credentials WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [userId]
    )
    if (nextRows[0]) {
      await pool.query(
        'UPDATE jarvis_user_credentials SET is_default = 1 WHERE id = $1 AND user_id = $2',
        [nextRows[0].id, userId]
      )
    }
  }
  return true
}
