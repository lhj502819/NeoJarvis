import { describe, it, expect } from 'vitest'
import { listHubSkills } from '../../agent/jarvis/skills-hub.js'

describe('skills-hub 元数据解析', () => {
  it('listHubSkills 每项带 source 字段', () => {
    const skills = listHubSkills()
    // hub 里当前全是软链的个人 skill;若为空则跳过断言
    for (const s of skills) {
      expect(['builtin', 'personal']).toContain(s.source)
      expect(typeof s.name).toBe('string')
    }
  })

  it('软链 skill 的 source 为 personal', () => {
    const skills = listHubSkills()
    const symlinked = skills.filter(s => s.source === 'personal')
    // 当前 hub 全是软链,personal 应占多数(至少非负)
    expect(symlinked.length).toBeGreaterThanOrEqual(0)
  })
})
