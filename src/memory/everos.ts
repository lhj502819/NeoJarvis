const EVEROS_BASE = 'https://api.evermind.ai/api/v1'
const EVEROS_API_KEY = process.env.EVEROS_API_KEY || 'd66c8be1-7f5c-400e-ab37-beba229bf028'
const USER_ID = 'hongjian'

interface MemoryMessage {
  role: 'user' | 'assistant'
  timestamp: number
  content: string
}

interface SearchResult {
  episode: string
  facts: string[]
  score: number
}

async function everosFetch(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${EVEROS_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EVEROS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`EverOS API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function addMemory(sessionId: string, messages: MemoryMessage[]): Promise<void> {
  if (!EVEROS_API_KEY) return

  await everosFetch('/memories', {
    user_id: USER_ID,
    session_id: sessionId,
    messages: messages.map(m => ({
      role: m.role,
      timestamp: m.timestamp,
      content: m.content,
    })),
  })
}

export async function flushMemory(sessionId: string): Promise<void> {
  if (!EVEROS_API_KEY) return

  await everosFetch('/memories/flush', {
    user_id: USER_ID,
    session_id: sessionId,
  })
}

export async function searchMemory(query: string, topK = 5): Promise<string> {
  if (!EVEROS_API_KEY) return ''

  try {
    const result = await everosFetch('/memories/search', {
      filters: { user_id: USER_ID },
      query,
      method: 'hybrid',
      top_k: topK,
    }) as { data?: { episodes?: Array<{ episode?: string; facts?: string[] }> } }

    const episodes = result.data?.episodes
    if (!episodes || episodes.length === 0) return ''

    return episodes
      .map(ep => {
        const parts: string[] = []
        if (ep.episode) parts.push(ep.episode)
        if (ep.facts && ep.facts.length > 0) parts.push(`事实: ${ep.facts.join('; ')}`)
        return parts.join('\n')
      })
      .join('\n---\n')
  } catch {
    return ''
  }
}

export async function getMemories(): Promise<string> {
  if (!EVEROS_API_KEY) return ''

  try {
    const result = await everosFetch('/memories/get', {
      filters: { user_id: USER_ID },
      memory_type: 'episodic_memory',
    }) as { data?: { episodes?: Array<{ episode?: string }> } }

    const episodes = result.data?.episodes
    if (!episodes || episodes.length === 0) return ''

    return episodes
      .slice(0, 10)
      .map(ep => ep.episode || '')
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

export function isMemoryConfigured(): boolean {
  return !!EVEROS_API_KEY
}
