import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'

// registry.ts now calls the Java server via shared/server-client instead of PostgreSQL.
// We mock server-client with an in-memory fake that mirrors the Java RecipeService defaults
// (skills=[], model='sonnet', context={}, persistent=false, createdBy='jarvis', 8-char id),
// so this stays a pure unit test of the TS layer (createRecipe forwarding + getRecipe filter).
const store = vi.hoisted(() => ({ recipes: [] as any[] }))

vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async (_userId: string, path: string) => {
    if (path === '/api/recipes') return store.recipes.filter(r => r._userId === _userId)
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

const { createRecipe, getRecipe } = await import('../../src/team/registry.js')

const USER = `u-rs-${Date.now()}`

describe('recipe skills 读写', () => {
  beforeEach(() => { store.recipes.length = 0 })

  it('createRecipe 写入 skills 并可读回', async () => {
    const r = await createRecipe(USER, {
      name: '测试专家', description: 'd', systemPrompt: 'p',
      tools: ['Read'], skills: ['promote-agent', 'research'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual(['promote-agent', 'research'])
  })

  it('createRecipe 不传 skills 默认空数组', async () => {
    const r = await createRecipe(USER, {
      name: '无技能', description: 'd', systemPrompt: 'p', tools: ['Read'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual([])
  })
})
