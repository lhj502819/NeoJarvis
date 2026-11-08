// 自托管 EverOS(开源版 1.5.1,Apache-2.0):本地 Memory API v2。
// 启动:~/.everos-venv/bin/everos server start --root ~/.everos(健康检查 /health)。
// 托管云(api.evermind.ai)的 v1 路径在自托管版不存在,这里统一走 v2 契约;
// 记忆的用户作用域由 messages[].sender_id 决定(= jarvis userId,按用户隔离)。
const EVEROS_BASE = process.env.EVEROS_BASE || 'http://127.0.0.1:8000/api/v2/memory'

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

export async function addMemory(userId: string, sessionId: string, messages: MemoryMessage[]): Promise<void> {
  await everosFetch('/add', {
    session_id: sessionId,
    messages: messages.map(m => ({
      sender_id: userId,   // v2:用户作用域由 sender_id 决定
      role: m.role,
      timestamp: m.timestamp,
      content: m.content,
    })),
  })
}

export async function flushMemory(userId: string, sessionId: string): Promise<void> {
  await everosFetch('/flush', {
    session_id: sessionId,
  })
}

export async function searchMemory(userId: string, query: string, topK = 5): Promise<string> {
  try {
    const result = await everosFetch('/search', {
      user_id: userId,
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
