import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { createRecipe, getRecipe } from '../../src/team/registry.js'

const USER = `u-rs-${Date.now()}`

describe('recipe skills 读写', () => {
  beforeAll(async () => { await initDb() })

  it('createRecipe 写入 skills 并可读回', async () => {
    const r = await createRecipe(USER, {
      name: '测试专家', description: 'd', systemPrompt: 'p',
      tools: ['Read'], skills: ['promote-agent', 'research'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual(['promote-agent', 'research'])
    await pool.query('DELETE FROM jarvis_recipes WHERE id=$1', [r.id])
  })

  it('createRecipe 不传 skills 默认空数组', async () => {
    const r = await createRecipe(USER, {
      name: '无技能', description: 'd', systemPrompt: 'p', tools: ['Read'],
    })
    const fetched = await getRecipe(USER, r.id)
    expect(fetched?.skills).toEqual([])
    await pool.query('DELETE FROM jarvis_recipes WHERE id=$1', [r.id])
  })
})
