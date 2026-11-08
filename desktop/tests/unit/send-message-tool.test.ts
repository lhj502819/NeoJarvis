import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTasks = vi.fn()
const sendToAgent = vi.fn()
const bus = { register: vi.fn(), unregister: vi.fn(), notify: vi.fn(), record: vi.fn(), isRegistered: vi.fn(), send: vi.fn(), drainInbox: vi.fn(() => []), peekInbox: vi.fn(() => []) }

vi.mock('../../agent/task/manager.js', () => ({
  listTasks: (...args: unknown[]) => listTasks(...args),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}))
vi.mock('../../agent/a2a/client.js', () => ({
  sendToAgent: (...args: unknown[]) => sendToAgent(...args),
  interruptAgent: vi.fn(),
}))
vi.mock('../../agent/a2a/bus.js', () => ({ bus }))

const { createJarvisTools } = await import('../../agent/jarvis/tools.js')
const tool = createJarvisTools('u-test').find(t => t.name === 'send_message')!

const call = async (status: string) => {
  listTasks.mockResolvedValue([{ id: 't1', subtasks: [{ id: 'st1', name: '子任务', status }] }])
  const result = await (tool.execute as any)('call-1', { subtaskId: 'st1', message: 'hi' })
  return result.content[0].text as string
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('send_message tool', () => {
  it('已结束的子任务直接拒绝，不调用 sendToAgent', async () => {
    const text = await call('completed')
    expect(text).toContain('已结束')
    expect(text).toContain('不要对 Sir 说')
    expect(sendToAgent).not.toHaveBeenCalled()
  })

  it('运行中且送达：即时注入并记录，不重复进收件箱', async () => {
    sendToAgent.mockResolvedValue(true)
    const text = await call('running')
    expect(text).toContain('已即时送达')
    expect(bus.record).toHaveBeenCalled()
    expect(bus.notify).not.toHaveBeenCalled()
  })

  it('运行中但不在线：消息进离线收件箱', async () => {
    sendToAgent.mockResolvedValue(false)
    const text = await call('running')
    expect(text).toContain('离线收件箱')
    expect(bus.notify).toHaveBeenCalled()
  })

  it('未找到子任务时明确失败', async () => {
    listTasks.mockResolvedValue([{ id: 't1', subtasks: [] }])
    const result = await (tool.execute as any)('call-1', { subtaskId: 'missing', message: 'hi' })
    expect(result.content[0].text).toContain('未找到子任务')
  })
})
