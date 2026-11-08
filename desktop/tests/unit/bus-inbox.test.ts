import { describe, it, expect, beforeEach, vi } from 'vitest'

// bus 依赖 Java server-client(recordMessage → POST /api/agent-messages)。mock 掉 server-client,
// 用一个内存 fake 记录 POST 过的消息,让我们能纯内存验证 inbox/drain 语义,不起真实 HTTP。
const posted: Array<{ path: string; body: unknown }> = []
vi.mock('../../agent/shared/server-client.js', () => ({
  serverPost: vi.fn(async (_userId: string, path: string, body?: unknown) => {
    posted.push({ path, body })
    return undefined
  }),
  serverGet: vi.fn(async () => undefined),
}))

import { bus, type A2AMessage } from '../../agent/a2a/bus.js'

function lastText(msgs: A2AMessage[]): string {
  const m = msgs[msgs.length - 1]
  return m?.parts.find(p => p.kind === 'text')?.text || ''
}

describe('MessageBus inbox/drain 语义（Jarvis → 小弟 中途注入）', () => {
  const AGENT = 'subtask-abc123'
  const U = 'test-user'

  beforeEach(() => {
    posted.length = 0
    bus.clear(AGENT)
  })

  it('notify 把消息放进已注册 agent 的 inbox（进得去，不丢）', async () => {
    bus.register(AGENT, 'TestAgent', async () => null)

    await bus.notify(U, 'jarvis', AGENT, AGENT, '补充需求：加上代理IP')

    // 消息躺在 inbox 里等待 drain（模拟小弟还没转到下一个 message 迭代）
    const pending = bus.peekInbox(AGENT)
    expect(pending.length).toBe(1)
    expect(lastText(pending)).toBe('补充需求：加上代理IP')

    // recordMessage 已改走 Java server-client:POST /api/agent-messages
    expect(posted).toHaveLength(1)
    expect(posted[0].path).toBe('/api/agent-messages')
  })

  it('drainInbox 取出后清空（模拟小弟回合迭代时读取并注入）', async () => {
    bus.register(AGENT, 'TestAgent', async () => null)
    await bus.notify(U, 'jarvis', AGENT, AGENT, '消息A')
    await bus.notify(U, 'jarvis', AGENT, AGENT, '消息B')

    // 小弟转到下一圈 for-await 时 drain
    const drained = bus.drainInbox(AGENT)
    expect(drained.length).toBe(2)
    expect(drained.map(m => m.parts[0].text)).toEqual(['消息A', '消息B'])

    // drain 后 inbox 清空——下一圈不会重复处理
    expect(bus.peekInbox(AGENT).length).toBe(0)
    expect(bus.drainInbox(AGENT).length).toBe(0)
  })

  it('多条消息在两次 drain 之间累积（模拟长 turn 期间连发）', async () => {
    bus.register(AGENT, 'TestAgent', async () => null)

    // 小弟卡在生成长 HTML 的一个 turn 里，期间 Jarvis 连发 3 条
    await bus.notify(U, 'jarvis', AGENT, AGENT, '第1条')
    await bus.notify(U, 'jarvis', AGENT, AGENT, '第2条')
    await bus.notify(U, 'jarvis', AGENT, AGENT, '第3条')

    // 都还在 inbox，一条没丢
    expect(bus.peekInbox(AGENT).length).toBe(3)

    // 长 turn 结束、进入下一次迭代 → 一次性 drain 全部
    const drained = bus.drainInbox(AGENT)
    expect(drained.length).toBe(3)
  })

  it('未注册的 agent：notify 进离线收件箱，register 后回灌', async () => {
    // 不 register —— 模拟小弟暂时不在线 / 尚未启动
    expect(bus.isRegistered(AGENT)).toBe(false)

    await bus.notify(U, 'jarvis', AGENT, AGENT, '发给离线小弟')

    expect(bus.peekInbox(AGENT).length).toBe(0)
    expect(bus.peekOfflineInbox(AGENT).length).toBe(1)

    // 小弟启动/恢复后注册，离线消息回灌到在线 inbox，check_inbox 可读
    bus.register(AGENT, 'TestAgent', async () => null)
    const drained = bus.drainInbox(AGENT)
    expect(drained.map(m => m.parts[0].text)).toEqual(['发给离线小弟'])
  })

  it('record 只落库、不投递（避免 steer 后 check_inbox 重复读）', async () => {
    bus.register(AGENT, 'TestAgent', async () => null)
    await bus.record(U, 'jarvis', AGENT, AGENT, '已经 steer 过的消息')
    expect(bus.peekInbox(AGENT).length).toBe(0)
    expect(posted.length).toBe(1)
  })

  it('小弟主动 send → 同步拿到 Jarvis handler 的回复（实时双向）', async () => {
    // 注册一个假 Jarvis，handler 立即回复
    bus.register('jarvis', 'Jarvis', async (msg) => ({
      id: 'r1',
      from: 'jarvis',
      to: msg.from,
      contextId: msg.contextId,
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: '批准，继续' }],
      timestamp: new Date().toISOString(),
    }))

    const reply = await bus.send(U, AGENT, 'jarvis', 'task-1', '[question] 要不要加代理?')
    expect(lastText(reply ? [reply] : [])).toBe('批准，继续')

    bus.unregister('jarvis')
  })
})
