import db from '../shared/db.js'

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

export function recordAgentSession(userId: string, sessionId: string, recipeId: string, description: string, domain?: string, cwd?: string) {
  const keywords = extractKeywords(description)

  const existing = db.prepare('SELECT * FROM jarvis_claude_sessions WHERE user_id = ? AND session_id = ?').get(userId, sessionId) as any
  if (existing) {
    const oldTopics: string[] = JSON.parse(existing.topics)
    const merged = [...new Set([...oldTopics, ...keywords])]
    db.prepare(`
      UPDATE jarvis_claude_sessions SET topics = ?, last_task_description = ?, completed_at = ?, task_count = task_count + 1, domain = COALESCE(NULLIF(domain, ''), ?), cwd = COALESCE(NULLIF(cwd, ''), ?)
      WHERE user_id = ? AND session_id = ?
    `).run(JSON.stringify(merged), description, new Date().toISOString(), domain || '', cwd || '', userId, sessionId)
  } else {
    db.prepare(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(userId, sessionId, recipeId, domain || '', cwd || '', JSON.stringify(keywords), description, new Date().toISOString())

    // Keep max 50 sessions per user
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM jarvis_claude_sessions WHERE user_id = ?').get(userId) as any).cnt
    if (count > 50) {
      db.prepare(`
        DELETE FROM jarvis_claude_sessions WHERE id IN (
          SELECT id FROM jarvis_claude_sessions WHERE user_id = ? ORDER BY completed_at ASC LIMIT ?
        )
      `).run(userId, count - 50)
    }
  }
}

export function findMatchingSession(userId: string, description: string, recipeId: string): AgentSession | undefined {
  const rows = db.prepare('SELECT * FROM jarvis_claude_sessions WHERE user_id = ? AND recipe_id = ?').all(userId, recipeId) as any[]
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

export function listAgentSessions(userId: string): AgentSession[] {
  const rows = db.prepare('SELECT * FROM jarvis_claude_sessions WHERE user_id = ? ORDER BY completed_at DESC').all(userId) as any[]
  return rows.map(rowToSession)
}

export function getSessionsByDomain(userId: string, domain: string): AgentSession[] {
  const rows = db.prepare('SELECT * FROM jarvis_claude_sessions WHERE user_id = ? AND domain = ?').all(userId, domain) as any[]
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
