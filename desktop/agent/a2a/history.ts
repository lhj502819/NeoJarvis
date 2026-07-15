import { serverGet, serverPost } from '../shared/server-client.js'

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

export async function recordAgentSession(userId: string, sessionId: string, recipeId: string, description: string, domain?: string, cwd?: string): Promise<void> {
  // Keyword extraction, topic merge, task_count bump and the 50-session cap now live in the
  // Java POST /api/sessions upsert; we just hand over the raw description + optional domain/cwd.
  await serverPost(userId, '/api/sessions', { sessionId, recipeId, description, domain, cwd })
}

export async function findMatchingSession(userId: string, description: string, recipeId: string): Promise<AgentSession | undefined> {
  const sessions = await serverGet<AgentSession[]>(userId, `/api/sessions/match?recipeId=${encodeURIComponent(recipeId)}`)
  if (sessions.length === 0) return undefined

  const keywords = extractKeywords(description)
  if (keywords.length === 0) return undefined

  let best: AgentSession | undefined
  let bestScore = 0

  for (const session of sessions) {
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
  return serverGet<AgentSession[]>(userId, '/api/history')
}

export async function getSessionsByDomain(userId: string, domain: string): Promise<AgentSession[]> {
  return serverGet<AgentSession[]>(userId, `/api/sessions/by-domain?domain=${encodeURIComponent(domain)}`)
}

export function extractKeywords(text: string): string[] {
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

/**
 * 按 domain + 关键词重叠为临时工匹配可复用的历史 session。
 * 只返回真实 UUID sessionId(auto- 兜底 ID 无法 resume,排除)。
 * 打分 = 关键词重叠数 / 查询关键词数,≥0.3 命中,取最高分。
 * 数据由 Java GET /api/sessions/by-domain 提供(按 completed_at DESC),auto- 过滤与打分留本地。
 */
export async function findMatchingSessionByDomain(userId: string, domain: string, description: string): Promise<string | undefined> {
  if (!domain) return undefined
  const keywords = extractKeywords(description)
  if (keywords.length === 0) return undefined

  const sessions = await serverGet<AgentSession[]>(userId, `/api/sessions/by-domain?domain=${encodeURIComponent(domain)}`)
  const candidates = sessions.filter(s => !s.sessionId.startsWith('auto-'))
  if (candidates.length === 0) return undefined

  let best: string | undefined
  let bestScore = 0
  for (const session of candidates) {
    const overlap = keywords.filter(k => session.topics.some(t => t.includes(k) || k.includes(t)))
    const score = overlap.length / keywords.length
    if (score > bestScore && score >= 0.3) {
      bestScore = score
      best = session.sessionId
    }
  }
  return best
}
