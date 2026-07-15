import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../agent/shared/db.js'

describe('dashboard 数据层 schema', () => {
  beforeAll(async () => { await initDb() })

  it('jarvis_subtask_turns 表存在且可插入', async () => {
    const id = `test-turn-${Date.now()}`
    await pool.query(
      `INSERT INTO jarvis_subtask_turns (id, subtask_id, turn_index, text, started_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, 'st-x', 1, 'hello', new Date().toISOString(), new Date().toISOString()]
    )
    const { rows } = await pool.query('SELECT * FROM jarvis_subtask_turns WHERE id=$1', [id])
    expect(rows[0].text).toBe('hello')
    expect(rows[0].turn_index).toBe(1)
    await pool.query('DELETE FROM jarvis_subtask_turns WHERE id=$1', [id])
  })

  it('jarvis_subtasks 新列存在', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='jarvis_subtasks' AND column_name IN
      ('started_at','turn_count','retry_count','tokens_input','tokens_output')
    `)
    expect(rows.length).toBe(5)
  })
})
