import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { listSkillsForUser, setSkillEnabled } from '../../src/jarvis/skill-prefs.js'

const USER = `u-skillapi-${Date.now()}`

describe('skills API 数据契约', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [USER]) })

  it('listSkillsForUser 返回数组,项形状正确', async () => {
    const list = await listSkillsForUser(USER)
    expect(Array.isArray(list)).toBe(true)
    if (list.length > 0) {
      const s = list[0]
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('enabled')
      expect(s).toHaveProperty('source')
    }
  })

  it('toggle 往返:禁用再启用,状态随之变化', async () => {
    const before = await listSkillsForUser(USER)
    if (before.length === 0) return  // 本机 hub 为空则跳过
    const target = before[0].name
    await setSkillEnabled(USER, target, false)
    const afterDisable = await listSkillsForUser(USER)
    expect(afterDisable.find(s => s.name === target)?.enabled).toBe(false)
    await setSkillEnabled(USER, target, true)
    const afterEnable = await listSkillsForUser(USER)
    expect(afterEnable.find(s => s.name === target)?.enabled).toBe(true)
  })
})
