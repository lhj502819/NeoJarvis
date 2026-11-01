import { describe, it, expect, vi, beforeEach } from 'vitest'

// 问题1修复:任务结算后的自动汇报(finalizeAndReport)必须在并发/LLM 抽风下依然"必定落库、绝不静默"。
// 实测过 bug:结算瞬间多个 claude 并发 spawn,汇报的 rawLlmCall 起了头永不返回 → 脑锁被占死 + 聊天里
// 一条汇报都没有。修复三条契约,本测覆盖:
//   ① rawLlmCall 抛异常/超时 → 不冒泡、走兜底,addToBuffer 仍被调用,内容含原始 result(不静默)。
//   ② rawLlmCall 返回空串 → 同样走兜底。
//   ③ rawLlmCall 正常返回 → addToBuffer 收到润色版。
//   ④ withBrainLock 无论 fn 成功/抛都要释放锁(用真实现验证 finally 执行)。

const { USER, TASK } = vi.hoisted(() => ({ USER: 'u-1', TASK: 't-1' }))

// rawLlmCall 的行为由每个用例设定
let rawLlmBehavior: () => Promise<string> = async () => ''
// withBrainLock 释放次数(验证锁一定释放)
let lockReleases = 0
// 捕获 addToBuffer 调用
const bufferCalls: Array<{ role: string; content: string }> = []

vi.mock('../../agent/jarvis/llm.js', () => ({
  // 真实语义的 withBrainLock:prev.then(fn).finally(resolve)。这里简化为直接 await fn,
  // 并在 finally 计数,验证"fn 抛也释放锁"。
  withBrainLock: async (_userId: string, fn: () => Promise<any>) => {
    try { return await fn() } finally { lockReleases++ }
  },
  rawLlmCall: (..._args: any[]) => rawLlmBehavior(),
}))

vi.mock('../../agent/jarvis/conversation.js', () => ({
  addToBuffer: async (_userId: string, role: string, content: string) => {
    bufferCalls.push({ role, content })
    return bufferCalls.length
  },
  saveArtifact: async () => 'art-1',
}))

vi.mock('../../agent/jarvis/sse.js', () => ({ broadcast: vi.fn() }))
vi.mock('../../agent/jarvis/tools.js', () => ({ consumeArtifact: () => null }))
vi.mock('../../agent/a2a/client.js', () => ({
  takeWrittenFiles: () => [],
  dispatchToAgent: vi.fn(),
  interruptAgent: vi.fn(),
}))
vi.mock('../../agent/a2a/adhoc.js', () => ({ listAdhocAgents: async () => [] }))

// getTask 返回一个已结算任务(completed,带聚合 result)
let taskFixture: any = null
vi.mock('../../agent/task/manager.js', () => ({
  getTask: async () => taskFixture,
  createTask: vi.fn(), updateTask: vi.fn(), addSubTask: vi.fn(),
  getTaskSummary: vi.fn(), listTasks: vi.fn(), updateSubTask: vi.fn(),
  getActiveTasks: vi.fn(), cleanupStaleTasks: vi.fn(),
}))

const { finalizeAndReport } = await import('../../agent/jarvis/action-dispatcher.js')

function completedTask(result = '## 文案\n定稿内容\n\n## 演示文稿\nHTML内容') {
  return {
    id: TASK, name: '文案+演示文稿', description: 'd', status: 'completed',
    result, subtasks: [
      { id: 's1', name: '文案', status: 'completed', domain: '内容创作', result: '定稿' },
      { id: 's2', name: '演示文稿', status: 'completed', domain: '演示文稿制作', result: 'html' },
    ],
    createdAt: 'now', updatedAt: 'now',
  }
}

beforeEach(() => {
  bufferCalls.length = 0
  lockReleases = 0
  rawLlmBehavior = async () => ''
  taskFixture = completedTask()
})

describe('finalizeAndReport（问题1:汇报必定落库、绝不静默）', () => {
  it('rawLlmCall 抛异常 → 不冒泡,仍落库,内容兜底为原始 result', async () => {
    rawLlmBehavior = async () => { throw new Error('spawn hang / timeout') }
    await expect(finalizeAndReport(USER, TASK)).resolves.toBeUndefined()  // 不抛
    expect(bufferCalls.length).toBe(1)                                    // 必定落库
    expect(bufferCalls[0].role).toBe('jarvis')
    expect(bufferCalls[0].content).toContain('定稿内容')                  // 兜底含原始 result
    expect(lockReleases).toBe(1)                                          // 锁释放
  })

  it('rawLlmCall 返回空串 → 走兜底落库', async () => {
    rawLlmBehavior = async () => '   '
    await finalizeAndReport(USER, TASK)
    expect(bufferCalls.length).toBe(1)
    expect(bufferCalls[0].content).toContain('自动汇报')  // 兜底话术
    expect(bufferCalls[0].content).toContain('定稿内容')
  })

  it('rawLlmCall 正常返回 → 落库润色版(非兜底)', async () => {
    rawLlmBehavior = async () => 'Sir,活儿交齐了,两条线都收工。'
    await finalizeAndReport(USER, TASK)
    expect(bufferCalls.length).toBe(1)
    expect(bufferCalls[0].content).toBe('Sir,活儿交齐了,两条线都收工。')
    expect(lockReleases).toBe(1)
  })

  it('未结算(executing)或无 result → 不汇报', async () => {
    taskFixture = { ...completedTask(), status: 'executing' }
    await finalizeAndReport(USER, TASK)
    expect(bufferCalls.length).toBe(0)

    taskFixture = { ...completedTask(''), status: 'completed', result: '' }
    await finalizeAndReport(USER, TASK)
    expect(bufferCalls.length).toBe(0)
  })

  it('failed 任务也汇报(兜底话术标明未成)', async () => {
    rawLlmBehavior = async () => ''
    taskFixture = { ...completedTask('## 文案（执行失败）\napi 超时'), status: 'failed' }
    await finalizeAndReport(USER, TASK)
    expect(bufferCalls.length).toBe(1)
    expect(bufferCalls[0].content).toContain('未成')
  })
})
