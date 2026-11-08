import { describe, it, expect } from 'vitest'
import { buildDispatchDescription, resolveSubtaskDependsOn } from '../../agent/jarvis/action-dispatcher.js'

describe('buildDispatchDescription', () => {
  it('无主任务描述时原样返回子任务', () => {
    expect(buildDispatchDescription(undefined, '子任务')).toBe('子任务')
    expect(buildDispatchDescription('   ', '子任务')).toBe('子任务')
  })

  it('把主任务背景拼在子任务前面', () => {
    const out = buildDispatchDescription('主任务边界', '子任务步骤')
    expect(out).toContain('## 主任务背景')
    expect(out).toContain('主任务边界')
    expect(out).toContain('## 你负责的子任务')
    expect(out).toContain('子任务步骤')
  })

  it('子任务描述已包含主描述时不重复', () => {
    expect(buildDispatchDescription('主任务边界', '见主任务边界，然后做 X')).toBe('见主任务边界，然后做 X')
  })

  it('超长主描述会截断', () => {
    const out = buildDispatchDescription('x'.repeat(20_000), '子任务')
    expect(out).toContain('主任务描述已截断')
    expect(out.length).toBeLessThan(20_000)
  })
})

describe('resolveSubtaskDependsOn', () => {
  const map = new Map([['A', 'id-a'], ['B', 'id-b']])
  const created = ['id-a', 'id-b']

  it('支持子任务名、1-based 序号，并去重', () => {
    const r = resolveSubtaskDependsOn(['A', '2', 'A'], map, created)
    expect(r.ids).toEqual(['id-a', 'id-b'])
    expect(r.unresolved).toEqual([])
  })

  it('解析不了的依赖单独返回', () => {
    const r = resolveSubtaskDependsOn(['A', '不存在的任务', '9'], map, created)
    expect(r.ids).toEqual(['id-a'])
    expect(r.unresolved).toEqual(['不存在的任务', '9'])
  })

  it('空值返回空', () => {
    expect(resolveSubtaskDependsOn(undefined, map, created)).toEqual({ ids: [], unresolved: [] })
    expect(resolveSubtaskDependsOn([], map, created)).toEqual({ ids: [], unresolved: [] })
  })
})
