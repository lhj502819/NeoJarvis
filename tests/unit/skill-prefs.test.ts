import { describe, it, expect, vi, beforeEach } from 'vitest'

// skill-prefs 的黑名单数据层现在走 Java server(GET /api/skills/prefs、POST /api/skills/{name}/toggle),
// 不再直连 PostgreSQL。用内存 fake 模拟 Java SkillPrefsService 的黑名单语义(幂等启/禁、按用户隔离)。
// listHubSkills() 扫本机 ~/.claude/skills 仍是真实调用,保持不变。
const store = vi.hoisted(() => ({ disabled: new Map<string, Set<string>>() }))

vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async (userId: string, path: string) => {
    if (path === '/api/skills/prefs') {
      return { disabled: [...(store.disabled.get(userId) ?? [])] }
    }
    return {}
  },
  serverPost: async (userId: string, path: string, body?: any) => {
    const m = path.match(/^\/api\/skills\/(.+)\/toggle$/)
    if (m) {
      const name = m[1]
      const set = store.disabled.get(userId) ?? new Set<string>()
      if (body?.enabled) set.delete(name)
      else set.add(name)
      store.disabled.set(userId, set)
    }
    return { ok: true }
  },
  serverPatch: async () => ({ ok: true }),
  serverDelete: async () => ({ ok: true }),
}))

const { getDisabledSkills, setSkillEnabled } = await import('../../src/jarvis/skill-prefs.js')

const USER = `u-skillpref-${Date.now()}`

describe('skill-prefs 黑名单', () => {
  beforeEach(() => { store.disabled.clear() })

  it('初始无禁用,集合为空', async () => {
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(0)
  })

  it('禁用一个 skill 后集合含它', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(true)
  })

  it('重复禁用不报错(幂等)', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    await setSkillEnabled(USER, 'deep-research', false)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.size).toBe(1)
  })

  it('重新启用后集合不含它', async () => {
    await setSkillEnabled(USER, 'deep-research', false)
    await setSkillEnabled(USER, 'deep-research', true)
    const disabled = await getDisabledSkills(USER)
    expect(disabled.has('deep-research')).toBe(false)
  })

  it('按用户隔离', async () => {
    const OTHER = `${USER}-other`
    await setSkillEnabled(USER, 'docx', false)
    const otherDisabled = await getDisabledSkills(OTHER)
    expect(otherDisabled.has('docx')).toBe(false)
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
  })

  it('getEnabledHubSkills 不含被禁的、也不含管道 skill', async () => {
    const { getEnabledHubSkills } = await import('../../src/jarvis/skill-prefs.js')
    await setSkillEnabled(USER, 'deep-research', false)
    const enabled = await getEnabledHubSkills(USER)
    expect(enabled).not.toContain('deep-research')
    expect(enabled).not.toContain('promote-agent')
  })
})
