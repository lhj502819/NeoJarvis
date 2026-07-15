import { describe, it, expect, vi } from 'vitest'

// v0.3: getTaskDetail now fetches TaskDetail from the Java server (task + turnsBySubtask +
// artifacts) and re-merges the local A2A bus conversation. Here we mock the HTTP client:
// the known task id returns an assembled TaskDetail, anything else 404s (server-client
// throws with the status in the message) and getTaskDetail maps that to undefined.
const { TASK, SUB, USER } = vi.hoisted(() => ({
  TASK: 't-detail-1',
  SUB: 's-detail-1',
  USER: 'test-user',
}))

vi.mock('../../src/shared/server-client.js', () => ({
  serverGet: async (_userId: string, path: string) => {
    if (path === `/api/task/${TASK}`) {
      return {
        task: {
          id: TASK, name: '详情任务', description: 'd', status: 'completed',
          subtasks: [{ id: SUB, taskId: TASK, name: '子', description: 'd', assignee: 'general', status: 'completed', createdAt: 'now', updatedAt: 'now' }],
          createdAt: 'now', updatedAt: 'now',
        },
        turnsBySubtask: { [SUB]: [{ id: 'tn1', subtaskId: SUB, turnIndex: 1, text: '回合1', startedAt: 'now', createdAt: 'now' }] },
        messagesBySubtask: {},
        conversation: null,
        artifacts: [],
      }
    }
    throw new Error(`server GET ${path} -> 404 Not Found — 任务不存在`)
  },
  serverPost: vi.fn(),
  serverPatch: vi.fn(),
  serverDelete: vi.fn(),
}))

const { getTaskDetail } = await import('../../src/task/manager.js')

describe('getTaskDetail', () => {
  it('返回任务 + 子任务轨迹', async () => {
    const detail = await getTaskDetail(USER, TASK)
    expect(detail).toBeDefined()
    expect(detail!.task.name).toBe('详情任务')
    expect(detail!.turnsBySubtask[SUB].length).toBe(1)
    expect(detail!.turnsBySubtask[SUB][0].text).toBe('回合1')
    // Java has no bus, so the locally-merged conversation view is empty here.
    expect(detail!.messagesBySubtask[SUB]).toEqual([])
    expect(detail!.conversation).toBeNull()
  })

  it('不存在的任务返回 undefined', async () => {
    const detail = await getTaskDetail(USER, 'nonexistent')
    expect(detail).toBeUndefined()
  })
})
