import { describe, it, expect, beforeEach, vi } from 'vitest'

// P2 订阅直通:threads.ts 的幂等/订阅/投递/回落逻辑(文档表后端,mock docs+bus+manager)。
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

const busSend = vi.fn(async () => null)
const busIsRegistered = vi.fn(() => true)
vi.mock('../../agent/a2a/bus.js', () => ({
  bus: {
    send: (...args: unknown[]) => busSend(...(args as [])),
    isRegistered: (id: string) => busIsRegistered(id),
  },
}))

const getTask = vi.fn()
vi.mock('../../agent/task/manager.js', () => ({ getTask: (...a: unknown[]) => getTask(...(a as [])) }))

vi.mock('../../agent/jarvis/sse.js', () => ({ broadcast: vi.fn() }))
vi.mock('../../agent/jarvis/timeline-store.js', () => ({ appendComms: vi.fn(async () => {}) }))

const { recordTrigger, ensureThread, subscribeTask, unsubscribeTaskEverywhere, listSubscribers, deliverToTask, groupThreadKey }
  = await import('../../agent/a2a/threads.js')

const uid = 'u1'
const origin = { kind: 'group' as const, chatId: 'g1', chatName: '联调群' }

beforeEach(() => {
  store.clear()
  busSend.mockClear()
  busIsRegistered.mockClear().mockImplementation(() => true)
  getTask.mockReset()
})

describe('Trigger 幂等(dsh:Accepting a Trigger twice creates one Ticket)', () => {
  it('同 msgId 首次 true、再次 false', async () => {
    const tk = groupThreadKey('g1')
    const p = { msgId: 'm1', sender: 'lihongjian.34', text: '在吗', chatId: 'g1', chatName: '联调群' }
    expect(await recordTrigger(uid, tk, p)).toBe(true)
    expect(await recordTrigger(uid, tk, p)).toBe(false)
  })

  it('同 msgId 不同用户互不干扰', async () => {
    const tk = groupThreadKey('g1')
    const p = { msgId: 'm2', sender: 'a', text: 'x', chatId: 'g1', chatName: '联调群' }
    expect(await recordTrigger('uA', tk, p)).toBe(true)
    expect(await recordTrigger('uB', tk, p)).toBe(true)
  })
})

describe('订阅与解除', () => {
  it('群来源订阅后可列出;私聊来源不订阅', async () => {
    await subscribeTask(uid, 'task1', origin)
    expect(await listSubscribers(uid, groupThreadKey('g1'))).toEqual(['task1'])
    await subscribeTask(uid, 'task2', { kind: 'dm', chatId: 'sir', chatName: '私聊' })
    expect(await listSubscribers(uid, groupThreadKey('g1'))).toEqual(['task1'])
  })

  it('取消任务解除其全部订阅,不影响其他任务', async () => {
    await subscribeTask(uid, 'task1', origin)
    await subscribeTask(uid, 'task2', origin)
    await unsubscribeTaskEverywhere(uid, 'task1')
    expect(await listSubscribers(uid, groupThreadKey('g1'))).toEqual(['task2'])
  })
})

describe('直通投递(dsh Subscription & Pass-through)', () => {
  const payload = { msgId: 'm9', sender: 'lihongjian.34', text: '进度怎么样了', chatId: 'g1', chatName: '联调群' }

  it('执行中小弟在线 → 直通成功,bus.send 带追问标注', async () => {
    await subscribeTask(uid, 'task9', origin)
    getTask.mockResolvedValue({ id: 'task9', status: 'executing', subtasks: [{ id: 'st9', status: 'running', assignee: '阿镜' }] })
    const r = await deliverToTask(uid, 'task9', payload, { senderLabel: 'Sir(唯一主人)' })
    expect(r.delivered).toBe(true)
    expect(busSend).toHaveBeenCalledTimes(1)
    const [userId, from, to, ctxId, text, meta] = busSend.mock.calls[0] as unknown as[]
    expect(userId).toBe(uid)
    expect(to).toBe('st9')
    expect(ctxId).toBe('task9')
    expect(String(text)).toContain('追问')
    expect((meta as { type: string }).type).toBe('follow_up')
  })

  it('无执行中小弟 → 回落 Router(delivered=false)', async () => {
    await subscribeTask(uid, 'task9', origin)
    getTask.mockResolvedValue({ id: 'task9', status: 'completed', subtasks: [{ id: 'st9', status: 'completed', assignee: '阿镜' }] })
    const r = await deliverToTask(uid, 'task9', payload, { senderLabel: 'Sir(唯一主人)' })
    expect(r.delivered).toBe(false)
    expect(busSend).not.toHaveBeenCalled()
  })

  it('小弟会话不在线 → 回落 Router', async () => {
    await subscribeTask(uid, 'task9', origin)
    getTask.mockResolvedValue({ id: 'task9', status: 'executing', subtasks: [{ id: 'st9', status: 'running', assignee: '阿镜' }] })
    busIsRegistered.mockImplementation(() => false)
    const r = await deliverToTask(uid, 'task9', payload, { senderLabel: 'Sir(唯一主人)' })
    expect(r.delivered).toBe(false)
  })

  it('任务查不到 → 安全回落', async () => {
    getTask.mockResolvedValue(null)
    const r = await deliverToTask(uid, 'ghost', payload, { senderLabel: 'Sir(唯一主人)' })
    expect(r.delivered).toBe(false)
  })
})

describe('ensureThread 登记', () => {
  it('同线程重复 ensure 不报错(幂等覆盖写)', async () => {
    await ensureThread(uid, groupThreadKey('g1'), '联调群')
    await ensureThread(uid, groupThreadKey('g1'), '联调群')
    expect(store.has(`${uid}:thread:${groupThreadKey('g1')}`)).toBe(true)
  })
})
