import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../agent/shared/db.js'

describe('adhoc 数据层 schema', () => {
  beforeAll(async () => { await initDb() })

  it('jarvis_adhoc_agents 表存在且可插入', async () => {
    const id = `test-adhoc-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, 'u-x', '技术调研', 1, 'hello', '["a"]', 0, new Date().toISOString(), new Date().toISOString()]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_adhoc_agents WHERE id=$1', [id])
    expect(rows[0].domain).toBe('技术调研')
    expect(rows[0].task_count).toBe(1)
    await pool.query('DELETE FROM jarvis_adhoc_agents WHERE id=$1', [id])
  })

  it('jarvis_recipes 有 skills 列', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='jarvis_recipes' AND column_name='skills'
    `)
    expect(rows.length).toBe(1)
  })

  it('(user_id, domain) 唯一约束生效', async () => {
    const now = new Date().toISOString()
    const base = `dup-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,'u-dup','域A',1,'t','[]',0,$2,$2)`, [base + '-1', now]
    )
    await expect(pool.query(
      `INSERT INTO jarvis_adhoc_agents (id, user_id, domain, task_count, last_task_description, topics, promoted, created_at, updated_at)
       VALUES ($1,'u-dup','域A',1,'t','[]',0,$2,$2)`, [base + '-2', now]
    )).rejects.toThrow()
    await pool.query(`DELETE FROM jarvis_adhoc_agents WHERE user_id='u-dup'`)
  })
})
