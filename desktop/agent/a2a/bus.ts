import { randomUUID } from 'crypto'
import { serverGet, serverPost } from '../shared/server-client.js'

/**
 * v0.3: the message-bus data layer no longer touches PostgreSQL — it calls the Java server's
 * REST API (see AgentBusController). The in-memory agent registry / inbox / drain machinery
 * stays here (it wraps live handlers), but recordMessage and every history read go over HTTP.
 *
 * Writes carry the owner userId explicitly (每个 write 站点都有真实 userId 在手),作为
 * X-Internal-User 落到 thread.user_id —— 前端按登录用户查 thread,写错 owner(旧代码恒为
 * 'system')会让沟通记录查不到。全局读传 'local' 占位仅为过 dev-bypass 鉴权,server 不按
 * user 过滤会话,值不影响结果。
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

  async send(userId: string, from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): Promise<A2AMessage | null> {
    const msg = this.buildMessage(from, to, contextId, content, metadata)
    await this.recordMessage(userId, msg)

    const target = this.agents.get(to)
    if (!target) return null

    const reply = await target.handler(msg)
    if (reply) {
      await this.recordMessage(userId, reply)
    }
    return reply
  }

  async notify(userId: string, from: string, to: string, contextId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const msg = this.buildMessage(from, to, contextId, content, metadata)
    await this.recordMessage(userId, msg)

    const target = this.agents.get(to)
    if (target) {
      target.inbox.push(msg)
    }
  }

  async broadcast(userId: string, from: string, contextId: string, content: string): Promise<void> {
    const msg = this.buildMessage(from, '*', contextId, content)
    await this.recordMessage(userId, msg)

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

  private async recordMessage(userId: string, msg: A2AMessage): Promise<void> {
    // Upsert thread + insert message + trim happen server-side (ports the old pool.query block).
    // userId 落到 thread.user_id —— 必须是消息所属任务的真实 owner,前端按登录用户查沟通记录。
    await serverPost(userId, '/api/agent-messages', msg)
  }
}

// ─── Singleton ───

export const bus = new MessageBus()
