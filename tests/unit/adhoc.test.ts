import { describe, it, expect, vi } from 'vitest'

// C-9: adhoc.ts now calls the Java server (AdhocController) via shared/server-client instead
// of PostgreSQL. This test replaces the old real-PG setup with a mock of server-client backed
// by an in-memory fake adhoc store that mirrors AdhocService's rules (topic merge/dedup cap 20,
// promoted guard, auto- sessionId → null).
const store = vi.hoisted(() => ({ agents: [] as any[] }))

function realSessionId(sid?: string): string | undefined {
  if (!sid || sid.startsWith('auto-')) return undefined
  return sid
}

function strip(a: any) {
  const { _userId, ...rest } = a
  return { ...rest }
}

vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async (userId: string, path: string) => {
    if (path === '/api/adhoc') {
      return store.agents
        .filter(a => a._userId === userId && !a.promoted)
        .sort((x, y) => y.taskCount - x.taskCount)
        .map(strip)
    }
    const m = path.match(/^\/api\/adhoc\/([^/]+)$/)
    if (m) {
      const domain = decodeURIComponent(m[1])
      const found = store.agents.find(a => a._userId === userId && a.domain === domain)
      if (!found) throw new Error(`server GET ${path} -> 404 Not Found`)
      return strip(found)
    }
    throw new Error(`unexpected GET ${path}`)
  },
  serverPost: async (userId: string, path: string, body?: any) => {
    if (path === '/api/adhoc') {
      const existing = store.agents.find(a => a._userId === userId && a.domain === body.domain)
      if (existing && existing.promoted) return strip(existing)  // promoted guard: no-op
      const sid = realSessionId(body.sessionId)
      const incoming: string[] = body.topics ?? []
      const now = new Date().toISOString()
      if (existing) {
        existing.taskCount += 1
        existing.lastTaskDescription = body.taskDescription
        existing.topics = [...new Set([...existing.topics, ...incoming])].slice(0, 20)
        if (sid) existing.lastSessionId = sid
        existing.updatedAt = now
        return strip(existing)
      }
      const agent = {
        _userId: userId,
        id: `adhoc-${Math.random().toString(36).slice(2, 10)}`,
        userId,
        domain: body.domain,
        taskCount: 1,
        lastTaskDescription: body.taskDescription,
        cwd: body.cwd || undefined,
        topics: incoming,
        lastSessionId: sid,
        promoted: false,
        createdAt: now,
        updatedAt: now,
      }
      store.agents.push(agent)
      return strip(agent)
    }
    const pm = path.match(/^\/api\/adhoc\/([^/]+)\/promoted$/)
    if (pm) {
      const domain = decodeURIComponent(pm[1])
      const found = store.agents.find(a => a._userId === userId && a.domain === domain)
      if (found) found.promoted = true
      return { ok: true }
    }
    throw new Error(`unexpected POST ${path}`)
  },
}))

const { upsertAdhocAgent, getAdhocAgent, listAdhocAgents, markAdhocPromoted } = await import('../../src/a2a/adhoc.js')

const USER = `u-adhoc-${Date.now()}`

describe('adhoc 聚合存储', () => {
  it('首次 upsert 插入 task_count=1', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研A', topics: ['a', 'b'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(1)
    expect(a?.topics).toContain('a')
  })

  it('同 domain 再 upsert 累加 task_count 并合并 topics', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研B', topics: ['b', 'c'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)
    expect(a?.topics).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(a?.lastTaskDescription).toBe('调研B')
  })

  it('domain 为空跳过(不插入)', async () => {
    await upsertAdhocAgent(USER, { domain: '', taskDescription: 'x', topics: [] })
    const all = await listAdhocAgents(USER)
    expect(all.find(a => a.domain === '')).toBeUndefined()
  })

  it('仅存真实 sessionId,auto- 前缀不存', async () => {
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't', topics: [], sessionId: 'auto-123' })
    const a = await getAdhocAgent(USER, '差旅')
    expect(a?.lastSessionId).toBeUndefined()
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't2', topics: [], sessionId: 'real-uuid-abc' })
    const b = await getAdhocAgent(USER, '差旅')
    expect(b?.lastSessionId).toBe('real-uuid-abc')
  })

  it('markAdhocPromoted 置 promoted=1,listAdhocAgents 不再返回', async () => {
    await markAdhocPromoted(USER, '技术调研')
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.promoted).toBe(true)
    const list = await listAdhocAgents(USER)
    expect(list.find(x => x.domain === '技术调研')).toBeUndefined()
  })

  it('promoted 后同 domain upsert 不再累加', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研C', topics: [] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)  // 仍是 2,未累加
  })
})
