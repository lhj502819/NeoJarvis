import { randomUUID } from 'crypto'
import { serverGet, serverPost } from '../shared/server-client.js'

/**
 * v0.3: the message-bus data layer no longer touches PostgreSQL — it calls the Java server's
 * REST API (see AgentBusController). The in-memory agent registry / inbox / drain machinery
 * stays here (it wraps live handlers), but recordMessage and every history read go over HTTP.
 *
 * The bus has no per-call userId (it is agent↔agent traffic), so writes forward the owner as
 * X-Internal-User (`this.ownerUserId || 'system'`, matching the old thread.user_id default) and
 * the global reads pass a 'local' placeholder purely to satisfy the dev-bypass auth filter —
 * the server never scopes conversations by user, so the value does not affect results.
 */

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

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

class MessageBus {
  private agents = new Map<string, AgentNode>()
  private ownerUserId: string = ''

  setOwner(userId: string): void {
    this.ownerUserId = userId
  }

  /** Owner id for writes (thread.user_id), defaulting to 'system' like the old TS. */
  private writeUser(): string {
    return this.ownerUserId || 'system'
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
    await this.recordMessage(msg)

    const target = this.agents.get(to)
    if (!target) return null

    const reply = await target.handler(msg)
    if (reply) {
      await this.recordMessage(reply)
    }
    return reply
  }

  async notify(from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const msg = this.buildMessage(from, to, contextId, content, metadata)
    await this.recordMessage(msg)

    const target = this.agents.get(to)
    if (target) {
      target.inbox.push(msg)
    }
  }

  async broadcast(from: string, contextId: string, content: string): Promise<void> {
    const msg = this.buildMessage(from, '*', contextId, content)
    await this.recordMessage(msg)

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

  async getConversation(contextId: string): Promise<ConversationLog | undefined> {
    try {
      return await serverGet<ConversationLog>('local', `/api/agent-threads/${encodeURIComponent(contextId)}`)
    } catch (err) {
      if (isNotFound(err)) return undefined
      throw err
    }
  }

  async getAgentConversations(agentId: string): Promise<ConversationLog[]> {
    return serverGet<ConversationLog[]>('local', `/api/agent-threads?participant=${encodeURIComponent(agentId)}`)
  }

  async getRecentMessages(contextId: string, limit = 20): Promise<A2AMessage[]> {
    return serverGet<A2AMessage[]>('local', `/api/agent-threads/${encodeURIComponent(contextId)}/messages?limit=${limit}`)
  }

  async getAllConversations(): Promise<ConversationLog[]> {
    return serverGet<ConversationLog[]>('local', '/api/agent-threads')
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

  private async recordMessage(msg: A2AMessage): Promise<void> {
    // Upsert thread + insert message + trim happen server-side (ports the old pool.query block).
    await serverPost(this.writeUser(), '/api/agent-messages', msg)
  }
}

// ─── Singleton ───

export const bus = new MessageBus()
