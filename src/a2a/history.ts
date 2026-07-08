import pool from '../shared/db.js'

export interface AgentSession {
  sessionId: string
  recipeId: string
  domain: string
  cwd: string
  topics: string[]
  lastTaskDescription: string
  completedAt: string
  taskCount: number
}

function rowToSession(row: any): AgentSession {
  return {
    sessionId: row.session_id,
    recipeId: row.recipe_id,
    domain: row.domain || '',
    cwd: row.cwd || '',
    topics: JSON.parse(row.topics),
    lastTaskDescription: row.last_task_description,
    completedAt: row.completed_at,
    taskCount: row.task_count,
  }
}

export async function recordAgentSession(userId: string, sessionId: string, recipeId: string, description: string, domain?: string, cwd?: string): Promise<void> {
  const keywords = extractKeywords(description)

  const { rows } = await pool.query('SELECT * FROM jarvis_claude_sessions WHERE user_id = $1 AND session_id = $2', [userId, sessionId])
  const existing = rows[0]
  if (existing) {
    const oldTopics: string[] = JSON.parse(existing.topics)
    const merged = [...new Set([...oldTopics, ...keywords])]
    await pool.query(`
      UPDATE jarvis_claude_sessions SET topics = $1, last_task_description = $2, completed_at = $3, task_count = task_count + 1, domain = COALESCE(NULLIF(domain, ''), $4), cwd = COALESCE(NULLIF(cwd, ''), $5)
      WHERE user_id = $6 AND session_id = $7
    `, [JSON.stringify(merged), description, new Date().toISOString(), domain || '', cwd || '', userId, sessionId])
  } else {
    await pool.query(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
    `, [userId, sessionId, recipeId, domain || '', cwd || '', JSON.stringify(keywords), description, new Date().toISOString()])

    // Keep max 50 sessions per user
    const { rows: countRows } = await pool.query('SELECT COUNT(*) as cnt FROM jarvis_claude_sessions WHERE user_id = $1', [userId])
    const count = parseInt(countRows[0].cnt, 10)
    if (count > 50) {
      await pool.query(`
        DELETE FROM jarvis_claude_sessions WHERE id IN (
          SELECT id FROM jarvis_claude_sessions WHERE user_id = $1 ORDER BY completed_at ASC LIMIT $2
        )
      `, [userId, count - 50])
    }
  }
}

export async function findMatchingSession(userId: string, description: string, recipeId: string): Promise<AgentSession | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_claude_sessions WHERE user_id = $1 AND recipe_id = $2', [userId, recipeId])
  if (rows.length === 0) return undefined

  const keywords = extractKeywords(description)
  if (keywords.length === 0) return undefined

  let best: AgentSession | undefined
  let bestScore = 0

  for (const row of rows) {
    const session = rowToSession(row)
    const overlap = keywords.filter(k => session.topics.some(t => t.includes(k) || k.includes(t)))
    const score = overlap.length / Math.max(keywords.length, 1)

    if (score > bestScore && score >= 0.3) {
      bestScore = score
      best = session
    }
  }

  return best
}

export async function listAgentSessions(userId: string): Promise<AgentSession[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_claude_sessions WHERE user_id = $1 ORDER BY completed_at DESC', [userId])
  return rows.map(rowToSession)
}

export async function getSessionsByDomain(userId: string, domain: string): Promise<AgentSession[]> {
  const { rows } = await pool.query('SELECT * FROM jarvis_claude_sessions WHERE user_id = $1 AND domain = $2', [userId, domain])
  return rows.map(rowToSession)
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['的', '了', '和', '与', '是', '在', '对', '将', '把', '被', '用', '让',
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'is', 'on', 'that', 'this',
    '帮我', '调研', '查', '搜索', '分析', '总结', '对比', '一下', '什么', '哪些', '怎么'])

  return text
    .toLowerCase()
    .replace(/[，。！？、；：""''（）\[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w))
    .slice(0, 10)
}
