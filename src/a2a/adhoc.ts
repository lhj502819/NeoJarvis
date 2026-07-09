import { randomUUID } from 'crypto'
import type { AdhocAgent } from '../shared/types.js'
import pool from '../shared/db.js'

function rowToAdhoc(row: any): AdhocAgent {
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    taskCount: row.task_count,
    lastTaskDescription: row.last_task_description,
    cwd: row.cwd || undefined,
    topics: row.topics ? JSON.parse(row.topics) : [],
    lastSessionId: row.last_session_id || undefined,
    promoted: row.promoted === 1 || row.promoted === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 只有真实 sessionId 能 resume,auto- 兜底 ID 不存 */
function realSessionId(sessionId?: string): string | null {
  if (!sessionId || sessionId.startsWith('auto-')) return null
  return sessionId
}

export async function upsertAdhocAgent(userId: string, params: {
  domain: string
  taskDescription: string
  cwd?: string
  sessionId?: string
  topics: string[]
}): Promise<void> {
  if (!params.domain) return  // 无领域标签,无法聚合/晋升

  const now = new Date().toISOString()
  const sid = realSessionId(params.sessionId)
  const existing = await getAdhocAgent(userId, params.domain)

  if (existing) {
    if (existing.promoted) return  // 已晋升,不再累加临时工数据
    const mergedTopics = [...new Set([...existing.topics, ...params.topics])].slice(0, 20)
    await pool.query(`
      UPDATE jarvis_adhoc_agents
      SET task_count = task_count + 1, last_task_description = $1, topics = $2,
          last_session_id = COALESCE($3, last_session_id), updated_at = $4
      WHERE user_id = $5 AND domain = $6
    `, [params.taskDescription, JSON.stringify(mergedTopics), sid, now, userId, params.domain])
  } else {
    await pool.query(`
      INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, cwd, topics, last_session_id, promoted, created_at, updated_at)
      VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 0, $8, $8)
    `, [`adhoc-${randomUUID().slice(0, 8)}`, userId, params.domain, params.taskDescription, params.cwd || null, JSON.stringify(params.topics), sid, now])
  }
}

export async function getAdhocAgent(userId: string, domain: string): Promise<AdhocAgent | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE user_id = $1 AND domain = $2', [userId, domain])
  return rows[0] ? rowToAdhoc(rows[0]) : undefined
}

export async function listAdhocAgents(userId: string): Promise<AdhocAgent[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE user_id = $1 AND promoted = 0 ORDER BY task_count DESC', [userId])
  return rows.map(rowToAdhoc)
}

export async function markAdhocPromoted(userId: string, domain: string): Promise<void> {
  await pool.query('UPDATE jarvis_adhoc_agents SET promoted = 1 WHERE user_id = $1 AND domain = $2', [userId, domain])
}
