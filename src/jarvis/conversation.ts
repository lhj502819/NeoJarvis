import { randomUUID } from 'crypto'
import pool from '../shared/db.js'
import { redactSecrets } from '../shared/redact.js'
import { addMemory } from '../memory/everos.js'
import type { ChatImage } from '../shared/types.js'

const MAX_BUFFER_TURNS = 20

async function getOrCreateSession(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id FROM user_jarvis_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  )
  if (rows[0]) return rows[0].id

  const id = randomUUID()
  const now = new Date().toISOString()
  await pool.query(
    'INSERT INTO user_jarvis_sessions (id, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4)',
    [id, userId, now, now]
  )
  return id
}

export async function addToBuffer(userId: string, role: 'user' | 'jarvis', content: string, artifactId?: string, imageIds?: string[]) {
  const sessionId = await getOrCreateSession(userId)
  const now = Date.now()

  await pool.query(
    'INSERT INTO user_jarvis_messages (session_id, user_id, role, content, timestamp, artifact_id, image_ids) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [sessionId, userId, role, content, now, artifactId || null, imageIds && imageIds.length ? JSON.stringify(imageIds) : null]
  )
  await pool.query(
    'UPDATE user_jarvis_sessions SET updated_at = $1 WHERE id = $2',
    [new Date().toISOString(), sessionId]
  )
}

// 存用户发来的图片(base64),返回 id 列表,供挂到消息 image_ids
export async function saveChatImages(userId: string, images: ChatImage[]): Promise<string[]> {
  const ids: string[] = []
  for (const img of images) {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO jarvis_chat_images (id, user_id, media_type, data, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, userId, img.mediaType, img.data, Date.now()]
    )
    ids.push(id)
  }
  return ids
}

// 按 id 取回图片(供 /api/chat-image/:id)
export async function getChatImage(userId: string, id: string): Promise<{ mediaType: string; data: string } | null> {
  const { rows } = await pool.query(
    'SELECT media_type, data FROM jarvis_chat_images WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  if (!rows[0]) return null
  return { mediaType: rows[0].media_type, data: rows[0].data }
}

export async function getRecentConversation(userId: string): Promise<string> {
  const sessionId = await getOrCreateSession(userId)
  const { rows } = await pool.query(
    `SELECT role, content FROM (
      SELECT role, content, timestamp FROM user_jarvis_messages WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2
    ) sub ORDER BY timestamp ASC`,
    [sessionId, MAX_BUFFER_TURNS]
  )

  if (rows.length === 0) return ''
  return rows
    .map((t: any) => `${t.role === 'user' ? 'Sir' : 'Jarvis'}: ${redactSecrets(t.content)}`)
    .join('\n')
}

export async function saveConversation(userId: string, userMessage: string, jarvisResponse: string) {
  const sessionId = `jarvis-${userId}`
  const now = Date.now()
  addMemory(userId, sessionId, [
    { role: 'user', timestamp: now, content: redactSecrets(userMessage) },
    { role: 'assistant', timestamp: now + 100, content: redactSecrets(jarvisResponse) },
  ]).catch(() => {})
}

export async function saveArtifact(userId: string, artifact: { type: string; title: string; content: string; language?: string }, taskId?: string): Promise<string> {
  const id = randomUUID()
  await pool.query(
    'INSERT INTO jarvis_artifacts (id, user_id, type, title, content, language, created_at, task_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, userId, artifact.type, artifact.title, artifact.content, artifact.language || null, Date.now(), taskId || null]
  )
  return id
}
