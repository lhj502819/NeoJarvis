import { describe, it, expect, vi } from 'vitest'

/**
 * findLastSubtaskForReuse 的 assignee 形态兼容:
 * subtask.assignee 可能存 recipe id("d8853618"),也可能存名字("小谱")——
 * Jarvis 派单允许填描述性角色名,只按 id 查会让历史继承整个失效
 * (真实事故:PRD 修复任务没吃到排查任务的现场,重新 clone 仓库从零开始)。
 * 修复:按 id 查一次 + 按该 id 的 recipe.name 查一次,合并去重。
 */

const NOW = new Date().toISOString()

// 按路径模拟两个端点:/api/recipe/{id}/subtasks 与 /api/recipe/{name}/subtasks
vi.mock('../../agent/shared/server-client.js', () => ({
  serverGet: async (_userId: string, path: string) => {
    const key = decodeURIComponent(path.split('/')[3] || '')
    if (key === 'd8853618') {
      // 按 recipe id 查:名字派单的历史不在里面
      return [{ id: 'f909c89e', taskId: 't1', name: '基于核实结果出方案', description: 'PRD 路由方案', status: 'completed', domain: 'PRD开发', createdAt: NOW }]
    }
    if (key === '小谱') {
      // 按名字查:能看到名字派单的历史
      return [{ id: '24592286', taskId: 't2', name: '定位线上 PRD Agent 报错根因', description: '排查 startRound 校验与 gracefulShutdown', status: 'completed', domain: 'PRD开发', createdAt: NOW }]
    }
    return []
  },
  serverPost: async () => undefined,
}))

vi.mock('../../agent/team/registry.js', () => ({
  getRecipe: async (_userId: string, id: string) =>
    id === 'd8853618' ? { id, name: '小谱', description: '', systemPrompt: '', tools: [], skills: [], model: 'sonnet', context: {}, persistent: true, usageCount: 0, createdBy: 'jarvis', createdAt: NOW } : undefined,
}))

const { findLastSubtaskForReuse } = await import('../../agent/a2a/history.js')

const USER = `u-reuse-${Date.now()}`
const DESC = '修复 PRD Agent 的报错,补 gracefulShutdown 和分布式锁'

describe('findLastSubtaskForReuse — assignee 名字/ID 两种形态', () => {
  it('assignee 传 recipe id → 也能吃到「名字派单」的历史', async () => {
    const sid = await findLastSubtaskForReuse(USER, 'd8853618', 'PRD开发', DESC)
    // 关键词与 24592286(排查根因)重叠更高 → 命中名字派单那条
    expect(sid).toBe('24592286')
  })

  it('assignee 直接是名字(临时工/名字派单)→ 照常命中', async () => {
    const sid = await findLastSubtaskForReuse(USER, '小谱', 'PRD开发', DESC)
    expect(sid).toBe('24592286')
  })

  it('domain 过滤生效:不同 domain 不命中', async () => {
    const sid = await findLastSubtaskForReuse(USER, '小谱', '项目知识沉淀', DESC)
    expect(sid).toBeUndefined()
  })

  it('id 和 name 都查不到 → undefined', async () => {
    const sid = await findLastSubtaskForReuse(USER, '不存在的工', 'PRD开发', DESC)
    expect(sid).toBeUndefined()
  })
})
