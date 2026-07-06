import { randomUUID } from 'crypto'
import db from '../shared/db.js'

// ─── A2A Message Types ───

export interface A2APart {
  kind: 'text' | 'data'
  text?: string
  data?: unknown
}

export interface A2AMessage {
  id: string
  from: string
  to: string
  contextId: string
  role: 'user' | 'agent'
  parts: A2APart[]
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ConversationLog {
  contextId: string
  participants: string[]
  messages: A2AMessage[]
  createdAt: string
  updatedAt: string
}

// ─── Agent Node ───

type MessageHandler = (message: A2AMessage) => Promise<A2AMessage | null>

interface AgentNode {
  id: string
  name: string
  handler: MessageHandler
  inbox: A2AMessage[]
}

// ─── MessageBus ───

const MAX_CONVERSATIONS = 100

class MessageBus {
  private agents = new Map<string, AgentNode>()
  private ownerUserId: string = ''

  setOwner(userId: string): void {
    this.ownerUserId = userId
  }

  register(id: string, name: string, handler: MessageHandler): void {
    this.agents.set(id, { id, name, handler, inbox: [] })
  }

  unregister(id: string): void {
    this.agents.delete(id)
  }

  isRegistered(id: string): boolean {
    return this.agents.has(id)
  }

  listAgents(): Array<{ id: string; name: string }> {
    return [...this.agents.values()].map(a => ({ id: a.id, name: a.name }))
  }

  async send(from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): Promise<A2AMessage | null> {
    const msg = this.buildMessage(from, to, contextId, content, metadata)
    this.recordMessage(msg)

    const target = this.agents.get(to)
    if (!target) return null

    const reply = await target.handler(msg)
    if (reply) {
      this.recordMessage(reply)
    }
    return reply
  }

  notify(from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): void {
    const msg = this.buildMessage(from, to, contextId, content, metadata)
    this.recordMessage(msg)

    const target = this.agents.get(to)
    if (target) {
      target.inbox.push(msg)
    }
  }

  broadcast(from: string, contextId: string, content: string): void {
    const msg = this.buildMessage(from, '*', contextId, content)
    this.recordMessage(msg)

    for (const [id, node] of this.agents) {
      if (id !== from) {
        node.inbox.push(msg)
      }
    }
  }

  drainInbox(agentId: string): A2AMessage[] {
    const node = this.agents.get(agentId)
    if (!node) return []
    const messages = [...node.inbox]
    node.inbox = []
    return messages
  }

  peekInbox(agentId: string): A2AMessage[] {
    return this.agents.get(agentId)?.inbox || []
  }

  // ─── History ───

  getConversation(contextId: string): ConversationLog | undefined {
    const thread = db.prepare('SELECT * FROM jarvis_agent_threads WHERE id = ?').get(contextId) as any
    if (!thread) return undefined

    const msgRows = db.prepare('SELECT * FROM jarvis_agent_messages WHERE thread_id = ? ORDER BY timestamp ASC').all(contextId) as any[]
    return {
      contextId: thread.id,
      participants: JSON.parse(thread.participants),
      messages: msgRows.map(rowToMessage),
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
    }
  }

  getAgentConversations(agentId: string): ConversationLog[] {
    const threads = db.prepare(`SELECT * FROM jarvis_agent_threads WHERE participants LIKE ?`).all(`%"${agentId}"%`) as any[]
    return threads.map(t => this.getConversation(t.id)!)
  }

  getRecentMessages(contextId: string, limit = 20): A2AMessage[] {
    const rows = db.prepare('SELECT * FROM jarvis_agent_messages WHERE thread_id = ? ORDER BY timestamp DESC LIMIT ?').all(contextId, limit) as any[]
    return rows.reverse().map(rowToMessage)
  }

  getAllConversations(): ConversationLog[] {
    const threads = db.prepare('SELECT * FROM jarvis_agent_threads ORDER BY updated_at DESC LIMIT ?').all(MAX_CONVERSATIONS) as any[]
    return threads.map(t => ({
      contextId: t.id,
      participants: JSON.parse(t.participants),
      messages: [],
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }))
  }

  // ─── Private ───

  private buildMessage(from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): A2AMessage {
    return {
      id: randomUUID().slice(0, 12),
      from,
      to,
      contextId,
      role: from === 'jarvis' ? 'user' : 'agent',
      parts: [{ kind: 'text', text: content }],
      timestamp: new Date().toISOString(),
      metadata,
    }
  }

  private recordMessage(msg: A2AMessage): void {
    let thread = db.prepare('SELECT id, participants FROM jarvis_agent_threads WHERE id = ?').get(msg.contextId) as any

    if (!thread) {
      const participants = [msg.from]
      if (msg.to !== '*') participants.push(msg.to)
      db.prepare(`
        INSERT INTO jarvis_agent_threads (id, user_id, participants, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.contextId, this.ownerUserId || 'system', JSON.stringify(participants), msg.timestamp, msg.timestamp)
    } else {
      const participants: string[] = JSON.parse(thread.participants)
      let changed = false
      if (!participants.includes(msg.from)) { participants.push(msg.from); changed = true }
      if (msg.to !== '*' && !participants.includes(msg.to)) { participants.push(msg.to); changed = true }
      if (changed) {
        db.prepare('UPDATE jarvis_agent_threads SET participants = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(participants), msg.timestamp, msg.contextId)
      } else {
        db.prepare('UPDATE jarvis_agent_threads SET updated_at = ? WHERE id = ?').run(msg.timestamp, msg.contextId)
      }
    }

    db.prepare(`
      INSERT INTO jarvis_agent_messages (id, thread_id, sender, receiver, role, parts, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(msg.id, msg.contextId, msg.from, msg.to, msg.role, JSON.stringify(msg.parts), msg.timestamp, msg.metadata ? JSON.stringify(msg.metadata) : null)

    // Trim old threads
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM jarvis_agent_threads').get() as any).cnt
    if (count > MAX_CONVERSATIONS) {
      db.prepare(`
        DELETE FROM jarvis_agent_threads WHERE id IN (
          SELECT id FROM jarvis_agent_threads ORDER BY updated_at ASC LIMIT ?
        )
      `).run(count - MAX_CONVERSATIONS)
    }
  }
}

function rowToMessage(row: any): A2AMessage {
  return {
    id: row.id,
    from: row.sender,
    to: row.receiver,
    contextId: row.thread_id,
    role: row.role,
    parts: JSON.parse(row.parts),
    timestamp: row.timestamp,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }
}

// ─── Singleton ───

export const bus = new MessageBus()
