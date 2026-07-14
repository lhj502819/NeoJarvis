import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pool, { initDb } from '../../src/shared/db.js'
import { getDisabledSkills, setSkillEnabled } from '../../src/jarvis/skill-prefs.js'

const USER = `u-skillpref-${Date.now()}`

describe('skill-prefs 黑名单', () => {
  beforeAll(async () => { await initDb() })
  afterAll(async () => { await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [USER]) })

  it('初始无禁用,集合为空', async () => {
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(0)
  })

  it('禁用一个 skill 后集合含它', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(true)
  })

  it('重复禁用不报错(ON CONFLICT)', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(1)
  })

  it('重新启用后集合不含它', async () => {
    await setSkillEnabled(USER, 'deep-research', true)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(false)
  })

  it('按用户隔离', async () => {
    const OTHER = `${USER}-other`
    await setSkillEnabled(USER, 'docx', false)
    const otherDisabled = await getDisabledSkills(OTHER)
    expect(otherDisabled.has('docx')).toBe(false)
    await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id=$1', [OTHER])
  })

  it('listSkillsForUser 每项带 enabled,禁用项为 false', async () => {
    const { listSkillsForUser } = await import('../../src/jarvis/skill-prefs.js')
    await setSkillEnabled(USER, 'deep-research', false)
    const list = await listSkillsForUser(USER)
    const dr = list.find(s => s.name === 'deep-research')
    // hub 里可能没有 deep-research(取决于本机),有才断言
    if (dr) expect(dr.enabled).toBe(false)
    // 不应包含管道 skill
    expect(list.find(s => s.name === 'promote-agent')).toBeUndefined()
    await setSkillEnabled(USER, 'deep-research', true)
  })

  it('getEnabledHubSkills 不含被禁的、也不含管道 skill', async () => {
    const { getEnabledHubSkills } = await import('../../src/jarvis/skill-prefs.js')
    await setSkillEnabled(USER, 'deep-research', false)
    const enabled = await getEnabledHubSkills(USER)
    expect(enabled).not.toContain('deep-research')
    expect(enabled).not.toContain('promote-agent')
    await setSkillEnabled(USER, 'deep-research', true)
  })
})
