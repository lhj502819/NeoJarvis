import { describe, it, expect, beforeAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { setSubtaskStarted, recordTurn, finalizeSubtaskMeta, getSubtaskTurns } from '../../src/task/manager.js'

const TASK = `t-meta-${Date.now()}`
const SUB = `s-meta-${Date.now()}`
const USER = 'test-user'

describe('subtask 元信息读写', () => {
  beforeAll(async () => {
    await initDb()
    const now = new Date().toISOString()
    await pool.query(`INSERT INTO jarvis_tasks (id,user_id,name,description,status,created_at,updated_at) VALUES ($1,$2,'t','d','executing',$3,$3)`, [TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtasks (id,task_id,user_id,name,description,assignee,status,created_at,updated_at) VALUES ($1,$2,$3,'n','d','general','running',$4,$4)`, [SUB, TASK, USER, now])
  })

  it('setSubtaskStarted 写入开工时间', async () => {
    const ts = new Date().toISOString()
    await setSubtaskStarted(SUB, ts)
    const { rows } = await pool.query('SELECT started_at FROM jarvis_subtasks WHERE id=$1', [SUB])
    expect(rows[0].started_at).toBe(ts)
  })

  it('recordTurn + getSubtaskTurns 按 turnIndex 顺序', async () => {
    const t0 = new Date().toISOString()
    await recordTurn(SUB, 1, '第一回合', t0, t0)
    await recordTurn(SUB, 2, '第二回合', t0, t0)
    const turns = await getSubtaskTurns(SUB)
    expect(turns.length).toBe(2)
    expect(turns[0].turnIndex).toBe(1)
    expect(turns[1].text).toBe('第二回合')
  })

  it('finalizeSubtaskMeta 写入统计', async () => {
    await finalizeSubtaskMeta(SUB, { turnCount: 5, retryCount: 1, tokensInput: 100, tokensOutput: 200 })
    const { rows } = await pool.query('SELECT turn_count,retry_count,tokens_input,tokens_output FROM jarvis_subtasks WHERE id=$1', [SUB])
    expect(rows[0].turn_count).toBe(5)
    expect(rows[0].retry_count).toBe(1)
    expect(rows[0].tokens_input).toBe(100)
    expect(rows[0].tokens_output).toBe(200)
  })
})
