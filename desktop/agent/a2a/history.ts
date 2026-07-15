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

  const cleaned = text.toLowerCase().replace(/[，。！?、;:""''()\[\]{}]/g, ' ')
  const out = new Set<string>()
  for (const token of cleaned.trim().split(/\s+/)) {
    if (!token) continue
    // ASCII 长 token(英文/数字)按整体入
    if (token.length >= 2 && !stopWords.has(token) && isMostlyAscii(token)) {
      out.add(token)
    }
    // 从 token 里抽 CJK bigram(中文没空格,靠 bigram 才能跨会话命中)
    for (const bigram of cjkBigrams(token)) {
      if (!stopWords.has(bigram)) out.add(bigram)
      if (out.size >= 10) break
    }
    if (out.size >= 10) break
  }
  return [...out].slice(0, 10)
}

function isMostlyAscii(s: string): boolean {
  let ascii = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x80) ascii++
  return ascii * 2 >= s.length
}

function isCjk(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)
}

function cjkBigrams(s: string): string[] {
  const out: string[] = []
  let run = ''
  for (let i = 0; i < s.length; i++) {
    if (isCjk(s.charCodeAt(i))) {
      run += s[i]
    } else {
      for (let j = 0; j + 2 <= run.length; j++) out.push(run.slice(j, j + 2))
      run = ''
    }
  }
  for (let j = 0; j + 2 <= run.length; j++) out.push(run.slice(j, j + 2))
  return out
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
