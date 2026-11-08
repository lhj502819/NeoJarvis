import { describe, it, expect, beforeEach, vi } from 'vitest'

// P5 审批队列:创建幂等/批准派工/驳回记录/卡片关闭收尾(文档表后端,mock docs+依赖)
const store = new Map<string, unknown>()

vi.mock('../../agent/shared/docs.js', () => ({
  docPut: vi.fn(async (userId: string, kind: string, key: string, data: unknown) => {
    store.set(`${userId}:${kind}:${key}`, structuredClone(data))
  }),
  docGet: vi.fn(async (userId: string, kind: string, key: string) => {
    const hit = store.get(`${userId}:${kind}:${key}`)
    return hit === undefined ? null : structuredClone(hit)
  }),
  docDelete: vi.fn(async (userId: string, kind: string, key: string) => {
    store.delete(`${userId}:${kind}:${key}`)
  }),
  docList: vi.fn(async (userId: string, kind: string, prefix = '', _limit = 200) => {
    return [...store.entries()]
      .filter(([k]) => k.startsWith(`${userId}:${kind}:${prefix}`))
      .map(([k, data]) => ({ key: k.slice(`${userId}:${kind}:`.length), data: structuredClone(data) }))
  }),
}))

const dispatchCalls: Array<{ card: { cardId: string }; basis: string }> = []
vi.mock('../../agent/jarvis/orchestrator.js', () => ({
  enqueueBackgroundMessage: vi.fn((userId: string, text: string, _w: unknown, origin: unknown) => {
    dispatchCalls.push({ card: { cardId: (origin as { chatId: string }).chatId }, basis: text.slice(0, 40) })
  }),
  noopWriter: { id: 'noop', send: () => {}, end: () => {}, closed: false },
}))
vi.mock('../../agent/jarvis/sse.js', () => ({ broadcast: vi.fn() }))
vi.mock('../../agent/task/manager.js', () => ({ updateTask: vi.fn(async () => {}) }))
const abortCalls: string[] = []
vi.mock('../../agent/jarvis/action-dispatcher.js', () => ({
  abortTask: vi.fn((taskId: string) => { abortCalls.push(taskId) }),
}))
vi.mock('../../agent/events/sources/jdsme.js', () => ({
  jdmePlain: (t: string) => t,
  sendJdMe: vi.fn(async () => true),
  getJdMeOwnerErp: () => '',
}))
vi.mock('../../agent/auth/users.js', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../agent/events/sources/xingyun-client.js', () => ({
  XingyunClient: class { async cardDetail() { return { desc: '', descLink: '' } } },
}))

const { createApproval, decideApproval, listApprovals, closeTasksForCard, handleXingyunEvent }
  = await import('../../agent/events/sources/xingyun.js')
const { subscribeTask } = await import('../../agent/a2a/threads.js')

const uid = 'u1'

beforeEach(() => {
  store.clear()
  dispatchCalls.length = 0
  abortCalls.length = 0
})

describe('审批队列(P5)', () => {
  const card = { cardId: 'c1', title: '拼团加速包', url: 'http://x', creator: '李四', policyVersion: 'pv-abc' }

  it('创建幂等:同卡只挂一单', async () => {
    const a1 = await createApproval(uid, { kind: 'xingyun_card', ...card })
    const a2 = await createApproval(uid, { kind: 'xingyun_card', ...card })
    expect(a1.id).toBe(a2.id)
    expect(a1.status).toBe('pending')
  })

  it('批准 → 记录 approved 并以审批单为授权派工', async () => {
    await createApproval(uid, { kind: 'xingyun_card', ...card })
    const decided = await decideApproval(uid, 'ap-c1', 'approve')
    expect(decided?.status).toBe('approved')
    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0].card.cardId).toBe('c1')
    expect(dispatchCalls[0].basis).toContain('审批单')
  })

  it('驳回 → 记录理由,不派工;再决定无效(已定)', async () => {
    await createApproval(uid, { kind: 'xingyun_card', ...card })
    await decideApproval(uid, 'ap-c1', 'reject', '风险大')
    expect(dispatchCalls).toHaveLength(0)
    const again = await decideApproval(uid, 'ap-c1', 'approve')
    expect(again?.status).toBe('rejected')
    expect(dispatchCalls).toHaveLength(0)
    const all = await listApprovals(uid)
    expect(all[0].note).toBe('风险大')
  })

  it('handleXingyunEvent:approval 模式新卡进队列不直派;auto 模式直派', async () => {
    const mk = (approval: 'auto' | 'approval', id: string) => ({
      id: `ev-${id}`, source: 'xingyun' as const, type: 'xingyun_card' as const, userId: uid,
      payload: { card: { id, cardCode: 'REQ-1', title: `卡${id}`, status: { code: 1, desc: '进行中' }, creatorErp: 'zhangsan', creatorName: '张三', description: '', url: '' }, approval, policyVersion: 'pv-x' },
      receivedAt: Date.now(),
    })
    await handleXingyunEvent(mk('approval', 'A1'))
    expect(dispatchCalls).toHaveLength(0)
    expect((await listApprovals(uid, 'pending')).length).toBe(1)
    await handleXingyunEvent(mk('auto', 'A2'))
    expect(dispatchCalls).toHaveLength(1)
  })

  it('卡片关闭 → 订阅任务收尾(cancelled + abort + 退订)', async () => {
    const xingyunOrigin = { kind: 'dm' as const, chatId: 'c9', chatName: '行云卡 X', channel: 'xingyun' as const }
    await subscribeTask(uid, 'task9', xingyunOrigin)
    expect([...store.keys()].filter(k => k.includes('subscription')).length).toBe(1)
    await closeTasksForCard(uid, 'c9')
    expect(abortCalls).toEqual(['task9'])
    const subsLeft = [...store.keys()].filter(k => k.includes('subscription'))
    expect(subsLeft).toHaveLength(0)
  })
})
