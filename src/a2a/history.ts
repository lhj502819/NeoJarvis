import { loadJson, saveJson } from '../shared/store.js'

const HISTORY_FILE = 'agent-history.json'

export interface AgentSession {
  sessionId: string
  recipeId: string
  cwd: string
  topics: string[]
  lastTaskDescription: string
  completedAt: string
  taskCount: number
}

function load(): AgentSession[] {
  return loadJson<AgentSession[]>(HISTORY_FILE, [])
}

function save(sessions: AgentSession[]) {
  saveJson(HISTORY_FILE, sessions)
}

export function recordAgentSession(sessionId: string, recipeId: string, description: string, cwd?: string) {
  const sessions = load()
  const keywords = extractKeywords(description)

  const existing = sessions.find(s => s.sessionId === sessionId)
  if (existing) {
    existing.topics = [...new Set([...existing.topics, ...keywords])]
    existing.lastTaskDescription = description
    existing.completedAt = new Date().toISOString()
    existing.taskCount++
    if (cwd && !existing.cwd) existing.cwd = cwd
  } else {
    sessions.push({
      sessionId,
      recipeId,
      cwd: cwd || '',
      topics: keywords,
      lastTaskDescription: description,
      completedAt: new Date().toISOString(),
      taskCount: 1,
    })
  }

  if (sessions.length > 50) {
    sessions.splice(0, sessions.length - 50)
  }

  save(sessions)
}

export function findMatchingSession(description: string, recipeId: string): AgentSession | undefined {
  const sessions = load().filter(s => s.recipeId === recipeId)
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

export function listAgentSessions(): AgentSession[] {
  return load()
}

export function getSessionsByProject(cwd: string): AgentSession[] {
  return load().filter(s => s.cwd === cwd)
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
