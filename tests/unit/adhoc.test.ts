import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { upsertAdhocAgent, getAdhocAgent, listAdhocAgents, markAdhocPromoted } from '../../src/a2a/adhoc.js'

const USER = `u-adhoc-${Date.now()}`

describe('adhoc 聚合存储', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_adhoc_agents WHERE user_id=$1', [USER]) })

  it('首次 upsert 插入 task_count=1', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研A', topics: ['a', 'b'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(1)
    expect(a?.topics).toContain('a')
  })

  it('同 domain 再 upsert 累加 task_count 并合并 topics', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研B', topics: ['b', 'c'] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)
    expect(a?.topics).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(a?.lastTaskDescription).toBe('调研B')
  })

  it('domain 为空跳过(不插入)', async () => {
    await upsertAdhocAgent(USER, { domain: '', taskDescription: 'x', topics: [] })
    const all = await listAdhocAgents(USER)
    expect(all.find(a => a.domain === '')).toBeUndefined()
  })

  it('仅存真实 sessionId,auto- 前缀不存', async () => {
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't', topics: [], sessionId: 'auto-123' })
    const a = await getAdhocAgent(USER, '差旅')
    expect(a?.lastSessionId).toBeUndefined()
    await upsertAdhocAgent(USER, { domain: '差旅', taskDescription: 't2', topics: [], sessionId: 'real-uuid-abc' })
    const b = await getAdhocAgent(USER, '差旅')
    expect(b?.lastSessionId).toBe('real-uuid-abc')
  })

  it('markAdhocPromoted 置 promoted=1,listAdhocAgents 不再返回', async () => {
    await markAdhocPromoted(USER, '技术调研')
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.promoted).toBe(true)
    const list = await listAdhocAgents(USER)
    expect(list.find(x => x.domain === '技术调研')).toBeUndefined()
  })

  it('promoted 后同 domain upsert 不再累加', async () => {
    await upsertAdhocAgent(USER, { domain: '技术调研', taskDescription: '调研C', topics: [] })
    const a = await getAdhocAgent(USER, '技术调研')
    expect(a?.taskCount).toBe(2)  // 仍是 2,未累加
  })
})
