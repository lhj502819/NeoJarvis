import { describe, it, expect, vi } from 'vitest'

const NOW = new Date().toISOString()

// findMatchingSessionByDomain now pulls domain sessions from Java (GET /api/sessions/by-domain)
// and keeps the auto-% filter + keyword scoring local, so we mock the server-client layer.
vi.mock('../../agent/shared/server-client.js', () => ({
  serverGet: async (_userId: string, path: string) => {
    const domain = new URLSearchParams(path.split('?')[1] || '').get('domain')
    if (domain === '技术调研') {
      return [{ sessionId: 'real-sess-openspec', recipeId: 'adhoc-x', domain: '技术调研', cwd: '', topics: ['openspec', '调研', '工具'], lastTaskDescription: '调研 openspec 工具', completedAt: NOW, taskCount: 1 }]
    }
    if (domain === '差旅') {
      return [{ sessionId: 'auto-999', recipeId: 'adhoc-y', domain: '差旅', cwd: '', topics: ['机票', '差旅'], lastTaskDescription: '订机票', completedAt: NOW, taskCount: 1 }]
    }
    return []
  },
  serverPost: async () => undefined,
}))

const { findMatchingSessionByDomain } = await import('../../agent/a2a/history.js')

const USER = `u-sm-${Date.now()}`

describe('findMatchingSessionByDomain', () => {
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
