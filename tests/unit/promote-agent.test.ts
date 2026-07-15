import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'crypto'

// registry.ts (createRecipe/listRecipes) now calls the Java server via shared/server-client.
// The adhoc side (upsertAdhocAgent/markAdhocPromoted) still uses PostgreSQL directly, so this
// stays a hybrid test: real PG for adhoc state, an in-memory fake for the recipe layer.
const store = vi.hoisted(() => ({ recipes: [] as any[] }))

vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async (userId: string, path: string) => {
    if (path === '/api/recipes') return store.recipes.filter(r => r._userId === userId)
    if (path.startsWith('/api/recipes/by-ids')) {
      const ids = new URLSearchParams(path.split('?')[1]).get('ids')?.split(',') ?? []
      return store.recipes.filter(r => ids.includes(r.id))
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
    return { ok: true }
  },
  serverDelete: async () => ({ ok: true }),
  serverPatch: async () => ({ ok: true }),
}))

const pool = (await import('../../src/shared/db.js')).default
const { initDb } = await import('../../src/shared/db.js')
const { upsertAdhocAgent } = await import('../../src/a2a/adhoc.js')
const { promoteAdhocToRecipe } = await import('../../src/jarvis/tools.js')
const { listRecipes } = await import('../../src/team/registry.js')

const USER = `u-promo-${Date.now()}`

describe('promoteAdhocToRecipe', () => {
  beforeAll(async () => {
    await initDb()
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订机票', topics: ['机票'] })
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订酒店', topics: ['酒店'] })
  })
  afterAll(async () => {
    await pool.query('DELETE FROM jarvis_adhoc_agents WHERE user_id=$1', [USER])
  })

  it('转正创建 persistent recipe 并标记 adhoc promoted', async () => {
    const res = await promoteAdhocToRecipe(USER, '差旅出行')
    expect(res.ok).toBe(true)
    const recipes = await listRecipes(USER)
    const expert = recipes.find(r => r.context.domain === '差旅出行')
    expect(expert).toBeDefined()
    expect(expert?.persistent).toBe(true)
    // adhoc 行已标 promoted(listAdhocAgents 过滤 promoted,故查库确认)
    const { rows } = await pool.query('SELECT promoted FROM jarvis_adhoc_agents WHERE user_id=$1 AND domain=$2', [USER, '差旅出行'])
    expect(rows[0].promoted).toBe(1)
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
