import { randomUUID } from 'crypto'
import { loadJson, saveJson } from '../shared/store.js'

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

const CONVERSATIONS_FILE = 'bus-conversations.json'
const MAX_CONVERSATIONS = 100

class MessageBus {
  private agents = new Map<string, AgentNode>()
  private conversations: ConversationLog[] = []

  constructor() {
    this.conversations = loadJson<ConversationLog[]>(CONVERSATIONS_FILE, [])
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
    return this.conversations.find(c => c.contextId === contextId)
  }

  getAgentConversations(agentId: string): ConversationLog[] {
    return this.conversations.filter(c => c.participants.includes(agentId))
  }

  getRecentMessages(contextId: string, limit = 20): A2AMessage[] {
    const conv = this.conversations.find(c => c.contextId === contextId)
    if (!conv) return []
    return conv.messages.slice(-limit)
  }

  getAllConversations(): ConversationLog[] {
    return this.conversations
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
    let conv = this.conversations.find(c => c.contextId === msg.contextId)
    if (!conv) {
      conv = {
        contextId: msg.contextId,
        participants: [],
        messages: [],
        createdAt: msg.timestamp,
        updatedAt: msg.timestamp,
      }
      this.conversations.push(conv)
    }

    conv.messages.push(msg)
    conv.updatedAt = msg.timestamp

    if (!conv.participants.includes(msg.from)) conv.participants.push(msg.from)
    if (msg.to !== '*' && !conv.participants.includes(msg.to)) conv.participants.push(msg.to)

    if (this.conversations.length > MAX_CONVERSATIONS) {
      this.conversations = this.conversations.slice(-MAX_CONVERSATIONS)
    }

    this.persist()
  }

  private persist(): void {
    saveJson(CONVERSATIONS_FILE, this.conversations)
  }
}

// ─── Singleton ───

export const bus = new MessageBus()
