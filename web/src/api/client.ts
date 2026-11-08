const BASE = ''

export interface ChatEvent {
  type:
    | 'thinking' | 'progress' | 'delta'
    | 'thought_delta' | 'tool_use' | 'tool_done'
    | 'response' | 'artifact' | 'buffering' | 'merged' | 'interrupted'
    | 'user_message' | 'worker_msg' | 'jarvis_msg' | 'watchdog'
  content: string
}

export interface ChatImagePayload {
  mediaType: string
  data: string   // base64,不含 data URL 前缀
}

export async function* streamChat(message: string, signal?: AbortSignal, images?: ChatImagePayload[]): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message, ...(images && images.length ? { images } : {}) }),
    signal,
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      try {
        yield JSON.parse(payload) as ChatEvent
      } catch {}
    }
  }
}

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function postJSON<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function putJSON<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function deleteJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', credentials: 'include' })
  return res.json()
}

export async function fetchArtifact(id: string): Promise<{ type: string; title: string; content?: string; uri?: string; language?: string; version?: number }> {
  // v0.3: server returns EITHER content (legacy row) OR uri (new file-store row).
  // Caller must run loadArtifactContent (api/artifact-content.ts) to get the actual body.
  const res = await fetch(`${BASE}/api/artifact/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data
}
