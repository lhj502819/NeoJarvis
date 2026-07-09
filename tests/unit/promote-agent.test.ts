import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { upsertAdhocAgent } from '../../src/a2a/adhoc.js'
import { promoteAdhocToRecipe } from '../../src/jarvis/tools.js'
import { listRecipes } from '../../src/team/registry.js'

const USER = `u-promo-${Date.now()}`

describe('promoteAdhocToRecipe', () => {
  beforeAll(async () => {
    await initDb()
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订机票', topics: ['机票'] })
    await upsertAdhocAgent(USER, { domain: '差旅出行', taskDescription: '订酒店', topics: ['酒店'] })
  })
  afterAll(async () => {
    await pool.query('DELETE FROM jarvis_adhoc_agents WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM jarvis_recipes WHERE user_id=$1', [USER])
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
