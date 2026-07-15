import { describe, it, expect, vi, beforeEach } from 'vitest'

// skills 数据契约:黑名单数据层走 Java server,内存 fake 模拟启/禁;listHubSkills 扫本机保持真实。
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

const { listSkillsForUser, setSkillEnabled } = await import('../../src/jarvis/skill-prefs.js')

const USER = `u-skillapi-${Date.now()}`

describe('skills API 数据契约', () => {
  beforeEach(() => { store.disabled.clear() })

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
