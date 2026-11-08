import { redactSecrets } from '../shared/redact.js'
import { serverGet, serverPost } from '../shared/server-client.js'
import type { ChatImage } from '../shared/types.js'

/**
 * v0.3: the conversation data layer no longer touches PostgreSQL directly — it calls the
 * Java server's REST API (ConversationController / ArtifactController). Session reuse/create,
 * id generation and message ordering are all done server-side now. Signatures are unchanged
 * from the old pool-based version; every `userId` is forwarded as X-Internal-User by the
 * server-client.
 */

const MAX_BUFFER_TURNS = 20

/**
 * Base URL for the single endpoint (getChatImage) that returns raw bytes instead of JSON,
 * so it can't go through the JSON-parsing server-client. Kept in sync with server-client.ts.
 */
const SERVER_URL = process.env.JARVIS_SERVER_URL || 'http://localhost:8080'

export async function addToBuffer(userId: string, role: 'user' | 'jarvis', content: string, artifactId?: string, imageIds?: string[]): Promise<number> {
  // POST /api/conversation/messages appends to the user's latest session (server picks/creates it).
  // Undefined artifactId/imageIds are dropped by JSON.stringify → Java stores NULL (mirrors old SQL).
  // 返回自增主键 id,供工具调用 traces 按 message_id 关联使用。
  const { id } = await serverPost<{ id: number }>(userId, '/api/conversation/messages', { role, content, artifactId, imageIds })
  return id
}

// 存用户发来的图片(base64),返回 id 列表,供挂到消息 image_ids
export async function saveChatImages(userId: string, images: ChatImage[]): Promise<string[]> {
  // POST /api/chat-images → { ids } in input order (server assigns the ids the old code UUID'd locally).
  const { ids } = await serverPost<{ ids: string[] }>(userId, '/api/chat-images', { images })
  return ids
}

// 按 id 取回图片(供 /api/chat-image/:id)
export async function getChatImage(userId: string, id: string): Promise<{ mediaType: string; data: string } | null> {
  // Java GET /api/chat-image/{id} returns the DECODED image bytes with a Content-Type header
  // (built for the browser), not JSON — so serverGet's JSON.parse can't be used here. We fetch
  // raw (forwarding the same X-Internal-User header server-client uses), map 404 → null, and
  // re-encode the body to base64 so the return shape { mediaType, data } is unchanged from PG.
  const res = await fetch(`${SERVER_URL}/api/chat-image/${encodeURIComponent(id)}`, {
    headers: { 'X-Internal-User': userId },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`server GET /api/chat-image/${id} -> ${res.status} ${res.statusText}`)
  }
  const mediaType = res.headers.get('content-type') || 'application/octet-stream'
  const data = Buffer.from(await res.arrayBuffer()).toString('base64')
  return { mediaType, data }
}

export async function getRecentConversation(userId: string): Promise<string> {
  // GET /api/conversation returns the latest session's messages oldest-first (server caps at 500).
  // The old PG query kept only the last MAX_BUFFER_TURNS, so we slice the tail to match, then build
  // the same "Sir/Jarvis: <redacted>" transcript string (empty string when there are no messages).
  const messages = await serverGet<Array<{ role: string; content: string }>>(userId, '/api/conversation')
  if (messages.length === 0) return ''
  return messages
    .slice(-MAX_BUFFER_TURNS)
    .map(m => `${m.role === 'user' ? 'Sir' : 'Jarvis'}: ${redactSecrets(m.content)}`)
    .join('\n')
}

// 长期记忆(自建,规划中):原 saveConversation 只是把对话双写进 EverOS,EverOS 移除后无操作。
// 消息本身的持久化在 addToBuffer → Java/PG,不经过这里。

export async function saveArtifact(userId: string, artifact: { type: string; title: string; content: string; language?: string }, taskId?: string): Promise<string> {
  // POST /api/artifacts → { id } (server assigns the id + created_at + version default).
  const { id } = await serverPost<{ id: string }>(userId, '/api/artifacts', {
    type: artifact.type,
    title: artifact.title,
    content: artifact.content,
    language: artifact.language,
    taskId,
  })
  return id
}
