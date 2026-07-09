import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { findMatchingSessionByDomain } from '../../src/a2a/history.js'

const USER = `u-sm-${Date.now()}`

describe('findMatchingSessionByDomain', () => {
  beforeAll(async () => {
    await initDb()
    // 一条真实 UUID session,domain=技术调研,关键词含 openspec
    await pool.query(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES ($1, 'real-sess-openspec', 'adhoc-x', '技术调研', '', $2, '调研 openspec 工具', $3, 1)
    `, [USER, JSON.stringify(['openspec', '调研', '工具']), new Date().toISOString()])
    // 一条 auto- 兜底 ID,不应被返回
    await pool.query(`
      INSERT INTO jarvis_claude_sessions (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, completed_at, task_count)
      VALUES ($1, 'auto-999', 'adhoc-y', '差旅', '', $2, '订机票', $3, 1)
    `, [USER, JSON.stringify(['机票', '差旅']), new Date().toISOString()])
  })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_claude_sessions WHERE user_id=$1', [USER]) })

  it('同 domain + 关键词重叠命中,返回真实 sessionId', async () => {
    const sid = await findMatchingSessionByDomain(USER, '技术调研', '继续调研 openspec 的用法')
    expect(sid).toBe('real-sess-openspec')
  })

  it('关键词无重叠不命中', async () => {
    const sid = await findMatchingSessionByDomain(USER, '技术调研', '写一首关于春天的诗')
    expect(sid).toBeUndefined()
  })

  it('auto- 兜底 sessionId 不返回', async () => {
    const sid = await findMatchingSessionByDomain(USER, '差旅', '帮我订机票去差旅')
    expect(sid).toBeUndefined()
  })

  it('无该 domain 的 session 返回 undefined', async () => {
    const sid = await findMatchingSessionByDomain(USER, '不存在的领域', 'x')
    expect(sid).toBeUndefined()
  })
})
