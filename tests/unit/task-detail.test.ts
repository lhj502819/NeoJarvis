import { describe, it, expect, beforeAll, vi } from 'vitest'

// getTaskDetail -> loadSubTasks -> registry.listRecipesByIds now calls the Java server.
// This test only cares about task/subtask/turn data (real PG), so stub the recipe lookup
// to an empty result; unmatched assignees fall back to 'adhoc', which is fine here.
vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async () => [],
  serverPost: async () => ({ ok: true }),
  serverDelete: async () => ({ ok: true }),
  serverPatch: async () => ({ ok: true }),
}))

const pool = (await import('../../src/shared/db.js')).default
const { initDb } = await import('../../src/shared/db.js')
const { getTaskDetail } = await import('../../src/task/manager.js')

const TASK = `t-detail-${Date.now()}`
const SUB = `s-detail-${Date.now()}`
const USER = 'test-user'

describe('getTaskDetail', () => {
  beforeAll(async () => {
    await initDb()
    const now = new Date().toISOString()
    await pool.query(`INSERT INTO jarvis_tasks (id,user_id,name,description,status,created_at,updated_at) VALUES ($1,$2,'详情任务','d','completed',$3,$3)`, [TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtasks (id,task_id,user_id,name,description,assignee,status,created_at,updated_at) VALUES ($1,$2,$3,'子','d','general','completed',$4,$4)`, [SUB, TASK, USER, now])
    await pool.query(`INSERT INTO jarvis_subtask_turns (id,subtask_id,turn_index,text,started_at,created_at) VALUES ($1,$2,1,'回合1',$3,$3)`, [`tn-${Date.now()}`, SUB, now])
  })

  it('返回任务 + 子任务轨迹', async () => {
    const detail = await getTaskDetail(USER, TASK)
    expect(detail).toBeDefined()
    expect(detail!.task.name).toBe('详情任务')
    expect(detail!.turnsBySubtask[SUB].length).toBe(1)
    expect(detail!.turnsBySubtask[SUB][0].text).toBe('回合1')
  })

  it('不存在的任务返回 undefined', async () => {
    const detail = await getTaskDetail(USER, 'nonexistent')
    expect(detail).toBeUndefined()
  })
})
