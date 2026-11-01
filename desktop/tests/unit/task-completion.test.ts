import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fix A(非全成功也汇报)的核心结算逻辑:checkTaskCompletion 不再要求"全部 completed",
// 只要子任务全进终态(completed/failed/cancelled)就结算。有任一成功→completed;全军覆没→failed;
// 还有 running/pending→不结算(返回 false)。汇报静默 bug 的根:旧逻辑一个小弟没 completed 就永不结算。
//
// checkTaskCompletion 读走 getTask(→serverGet /api/task/:id),写走 updateTask(→serverPatch)。
// 这里 mock server-client:按 taskId 返回不同子任务组合,捕获 PATCH 断言最终 status + result。

const { USER } = vi.hoisted(() => ({ USER: 'test-user' }))

// 每个用例往这里塞一套子任务,mock 的 serverGet 读它拼 TaskDetail
let subtasksFixture: any[] = []
const patchCalls: Array<{ path: string; body: any }> = []

vi.mock('../../agent/shared/server-client.js', () => ({
  serverGet: async (_userId: string, path: string) => {
    const m = path.match(/^\/api\/task\/(.+)$/)
    if (m) {
      const id = decodeURIComponent(m[1])
      return {
        task: {
          id, name: '结算任务', description: 'd', status: 'executing',
          subtasks: subtasksFixture,
          createdAt: 'now', updatedAt: 'now',
        },
        turnsBySubtask: {}, messagesBySubtask: {}, conversation: null, artifacts: [],
      }
    }
    throw new Error(`server GET ${path} -> 404`)
  },
  serverPatch: async (_userId: string, path: string, body: any) => {
    patchCalls.push({ path, body })
    return { id: 't', ...body }
  },
  serverPost: vi.fn(),
  serverDelete: vi.fn(),
}))

const { checkTaskCompletion } = await import('../../agent/task/scheduler.js')

function sub(name: string, status: string, extra: Record<string, unknown> = {}) {
  return { id: `s-${name}`, taskId: 't', name, description: 'd', assignee: 'general', status, createdAt: 'now', updatedAt: 'now', ...extra }
}
function lastTaskPatch() {
  // updateTask 打到 /api/task/:id;updateSubTask 打到 /api/subtask/:id。只看任务级那条。
  return [...patchCalls].reverse().find(c => /^\/api\/task\//.test(c.path))?.body
}

beforeEach(() => { subtasksFixture = []; patchCalls.length = 0 })

describe('checkTaskCompletion（Fix A：非全成功也结算）', () => {
  it('全部 completed → 结算为 completed,聚合各子任务结果', async () => {
    subtasksFixture = [sub('文案', 'completed', { result: '文案成品' }), sub('演示', 'completed', { result: 'HTML成品' })]
    const settled = await checkTaskCompletion(USER, 't')
    expect(settled).toBe(true)
    const patch = lastTaskPatch()
    expect(patch.status).toBe('completed')
    expect(patch.result).toContain('文案成品')
    expect(patch.result).toContain('HTML成品')
  })

  it('部分失败但有成功 → 仍结算为 completed,失败环节带标注和错因', async () => {
    subtasksFixture = [sub('文案', 'completed', { result: '文案成品' }), sub('演示', 'failed', { error: 'spawn ENOENT' })]
    const settled = await checkTaskCompletion(USER, 't')
    expect(settled).toBe(true)
    const patch = lastTaskPatch()
    expect(patch.status).toBe('completed')          // 有一个成功就算 completed
    expect(patch.result).toContain('（执行失败）')  // 失败环节显式标注
    expect(patch.result).toContain('spawn ENOENT')  // 带上错因,汇报能说清
  })

  it('全部失败/取消 → 结算为 failed(不再静默停在 executing)', async () => {
    subtasksFixture = [sub('文案', 'failed', { error: 'API 超时' }), sub('演示', 'cancelled')]
    const settled = await checkTaskCompletion(USER, 't')
    expect(settled).toBe(true)
    expect(lastTaskPatch().status).toBe('failed')
  })

  it('仍有 running/pending → 不结算(返回 false,不写任务状态)', async () => {
    subtasksFixture = [sub('文案', 'completed', { result: 'x' }), sub('演示', 'running')]
    const settled = await checkTaskCompletion(USER, 't')
    expect(settled).toBe(false)
    expect(lastTaskPatch()).toBeUndefined()  // 没有任务级 PATCH
  })

  it('无子任务 → 不结算', async () => {
    subtasksFixture = []
    expect(await checkTaskCompletion(USER, 't')).toBe(false)
  })
})
