import { describe, it, expect, beforeAll, vi } from 'vitest'
import { randomUUID } from 'crypto'

// registry.ts (createRecipe/listRecipes) and adhoc.ts (upsertAdhocAgent/getAdhocAgent/
// markAdhocPromoted) both call the Java server via shared/server-client, so this test
// fakes both layers in one server-client mock.
const store = vi.hoisted(() => ({ recipes: [] as any[], adhoc: [] as any[] }))

function realSessionId(sid?: string): string | undefined {
  if (!sid || sid.startsWith('auto-')) return undefined
  return sid
}
function stripAdhoc(a: any) {
  const { _userId, ...rest } = a
  return { ...rest }
}

vi.mock('../../agent/shared/server-client.js', () => ({
  serverGet: async (userId: string, path: string) => {
    if (path === '/api/recipes') return store.recipes.filter(r => r._userId === userId)
    if (path.startsWith('/api/recipes/by-ids')) {
      const ids = new URLSearchParams(path.split('?')[1]).get('ids')?.split(',') ?? []
      return store.recipes.filter(r => ids.includes(r.id))
    }
    if (path === '/api/adhoc') {
      return store.adhoc.filter(a => a._userId === userId && !a.promoted)
        .sort((x, y) => y.taskCount - x.taskCount).map(stripAdhoc)
    }
    const m = path.match(/^\/api\/adhoc\/([^/]+)$/)
    if (m) {
      const domain = decodeURIComponent(m[1])
      const found = store.adhoc.find(a => a._userId === userId && a.domain === domain)
      if (!found) throw new Error(`server GET ${path} -> 404 Not Found`)
      return stripAdhoc(found)
    }
    return []
  },
  serverPost: async (userId: string, path: string, body?: any) => {
    if (path === '/api/recipes') {
      const recipe = {
        id: randomUUID().slice(0, 8),
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        skills: body.skills ?? [],
        model: body.model ?? 'sonnet',
        context: body.context ?? {},
        persistent: body.persistent ?? false,
        usageCount: 0,
        createdBy: body.createdBy ?? 'jarvis',
        createdAt: new Date().toISOString(),
        lastUsedAt: '',
      }
      store.recipes.push({ ...recipe, _userId: userId })
      return recipe
    }
    if (path === '/api/adhoc') {
      const existing = store.adhoc.find(a => a._userId === userId && a.domain === body.domain)
      if (existing && existing.promoted) return stripAdhoc(existing)
      const sid = realSessionId(body.sessionId)
      const incoming: string[] = body.topics ?? []
      const now = new Date().toISOString()
      if (existing) {
        existing.taskCount += 1
        existing.lastTaskDescription = body.taskDescription
        existing.topics = [...new Set([...existing.topics, ...incoming])].slice(0, 20)
        if (sid) existing.lastSessionId = sid
        existing.updatedAt = now
        return stripAdhoc(existing)
      }
      const agent = {
        _userId: userId, id: `adhoc-${randomUUID().slice(0, 8)}`, userId,
        domain: body.domain, taskCount: 1, lastTaskDescription: body.taskDescription,
        cwd: body.cwd || undefined, topics: incoming, lastSessionId: sid,
        promoted: false, createdAt: now, updatedAt: now,
      }
      store.adhoc.push(agent)
      return stripAdhoc(agent)
    }
    const pm = path.match(/^\/api\/adhoc\/([^/]+)\/promoted$/)
    if (pm) {
      const domain = decodeURIComponent(pm[1])
      const found = store.adhoc.find(a => a._userId === userId && a.domain === domain)
      if (found) found.promoted = true
      return { ok: true }
    }
    return { ok: true }
  },
  serverDelete: async () => ({ ok: true }),
  serverPatch: async () => ({ ok: true }),
}))

const { upsertAdhocAgent } = await import('../../agent/a2a/adhoc.js')
const { promoteAdhocToRecipe } = await import('../../agent/jarvis/tools.js')
const { listRecipes } = await import('../../agent/team/registry.js')

const USER = `u-promo-${Date.now()}`

describe('promoteAdhocToRecipe', () => {
  beforeAll(async () => {
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订机票', topics: ['机票'] })
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订酒店', topics: ['酒店'] })
  })

  it('转正创建 persistent recipe 并标记 adhoc promoted', async () => {
    const res = await promoteAdhocToRecipe(USER, '差旅出行')
    expect(res.ok).toBe(true)
    const recipes = await listRecipes(USER)
    const expert = recipes.find(r => r.context.domain === '差旅出行')
    expect(expert).toBeDefined()
    expect(expert?.persistent).toBe(true)
    // adhoc 行已标 promoted(listAdhocAgents 过滤 promoted,故查 fake store 确认)
    const row = store.adhoc.find(a => a._userId === USER && a.domain === '差旅出行')
    expect(row?.promoted).toBe(true)
  })

  it('无对应 adhoc 返回 ok=false', async () => {
    const res = await promoteAdhocToRecipe(USER, '不存在领域')
    expect(res.ok).toBe(false)
  })

  it('已 promoted 的领域重复转正返回 ok=false', async () => {
    const res = await promoteAdhocToRecipe(USER, '差旅出行')
    expect(res.ok).toBe(false)
  })
})
