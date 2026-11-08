import { describe, it, expect } from 'vitest'

// P1 预算单测:卡片三元组与分页的尺寸纪律(docs/superagent-design-v2.md P1)。
// 这些上限是"上下文不稀释注意力"的硬保证,漂移即回归。
import {
  preview, textPage, listPage, taskCard, messageStub, readResource,
  PREVIEW_MAX, LIST_PAGE_DEFAULT, LIST_PAGE_MAX, TEXT_PAGE_DEFAULT, TEXT_PAGE_MAX,
} from '../../agent/jarvis/context-resources.js'

describe('预览与分页预算', () => {
  it('preview:折叠空白 + 截断到 160 字', () => {
    const long = 'a'.repeat(500)
    expect(preview(long).length).toBe(PREVIEW_MAX)
    expect(preview('  多  空格   文本\n换行 ')).toBe('多 空格 文本 换行')
    expect(preview('', 50)).toBe('')
  })

  it('textPage:默认 4000/上限 8000,截断附续读指针,offset 续读', () => {
    const body = 'x'.repeat(10_000)
    const p1 = textPage('task/t1', body, { offset: 0 })
    expect(p1.length).toBeLessThanOrEqual(TEXT_PAGE_DEFAULT + 120)  // 正文 + 提示行
    expect(p1).toContain(`offset=${TEXT_PAGE_DEFAULT}`)
    const p2 = textPage('task/t1', body, { offset: 4000 })
    expect(p2).toContain('(从第 4000 字符继续,全文 10000 字)')
    const capped = textPage('task/t1', body, { offset: 0, limit: 99_999 })
    expect(capped).toContain(`offset=${TEXT_PAGE_MAX}`)  // limit 被上限 8000 压住,10000 字仍截断
    const short = textPage('task/t1', '短文', { offset: 0 })
    expect(short).toBe('短文')
  })

  it('listPage:默认 20/上限 50,next_offset 语义', () => {
    const items = Array.from({ length: 120 }, (_, i) => i)
    const p1 = listPage(items, { offset: 0 })
    expect(p1.items).toHaveLength(LIST_PAGE_DEFAULT)
    expect(p1.next_offset).toBe(LIST_PAGE_DEFAULT)
    const pAll = listPage(items, { offset: 0, limit: 500 })
    expect(pAll.items).toHaveLength(LIST_PAGE_MAX)
    const pEnd = listPage(items, { offset: 110 })
    expect(pEnd.items).toHaveLength(10)
    expect(pEnd.next_offset).toBeNull()
  })
})

describe('卡片三元组形态', () => {
  it('taskCard:指针 + 状态 + 预览 + 全文长度', () => {
    const desc = '把登录模块拆干净\n细节很多'.repeat(20)
    const collapsed = desc.replace(/\s+/g, ' ').trim().length
    const card = taskCard({ id: 't1', name: '重构登录', status: 'executing', description: desc })
    expect(card).toMatch(/^task\/t1 重构登录 · executing · /)
    expect(card).toContain(`· 全文${collapsed}字`)          // 长度是折叠空白后的
    expect(card.length).toBeLessThan(collapsed)              // 预览被 160 截断,卡片远短于全文
  })

  it('taskCard:无描述给占位', () => {
    expect(taskCard({ id: 't2', name: 'x', status: 'created' })).toContain('(无描述)')
  })

  it('messageStub:50 字预览 + 长度 + 读指针', () => {
    const stub = messageStub({ id: 42, role: 'user', content: '帮我看一下'.repeat(30) })
    expect(stub).toMatch(/^message\/42 Sir: /)
    expect(stub).toContain(`(${150}字)`)
  })
})

describe('worker 读边界(小弟越权拒绝)', () => {
  const workerScope = { role: 'worker' as const, taskId: 'mine' }

  it('只能读自己的 task/<id>', async () => {
    await expect(readResource('u', 'task/other', { offset: 0 }, workerScope)).rejects.toThrow('只能读自己绑定的任务')
  })

  it('tasks/message/conversation/trace/timeline 对小弟全部拒绝', async () => {
    for (const res of ['tasks', 'message/1', 'conversation', 'trace/x', 'timeline/1']) {
      await expect(readResource('u', res, { offset: 0 }, workerScope)).rejects.toThrow('read_context 拒绝')
    }
  })

  it('未知资源给可读的错误信息', async () => {
    await expect(readResource('u', 'nonsense', { offset: 0 }, { role: 'jarvis' })).rejects.toThrow('未知资源')
  })
})

// ── P6:技能目录预算(纯函数) ──
import { skillCatalogLines, SKILL_LINE_BUDGET } from '../../agent/jarvis/context-resources.js'

describe('skillCatalogLines 技能目录预算', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
    name: `skill-${i}`, description: `描述${i} `.repeat(20), enabled: true,
  }))

  it('总输出不超过预算,超预算截断并留 read_context 指针', () => {
    const out = skillCatalogLines(mk(85))
    expect(out.length).toBeLessThanOrEqual(SKILL_LINE_BUDGET + 120)  // 预算 + 截断提示行
    expect(out).toContain("read_context 'skills'")
  })

  it('禁用技能不进目录;全部放得下时不加指针', () => {
    const few = [{ name: 'a', description: '短', enabled: true }, { name: 'b', description: 'x', enabled: false }]
    const out = skillCatalogLines(few, 6000)
    expect(out).toContain('- a: 短')
    expect(out).not.toContain('- b')
    expect(out).not.toContain('read_context')
  })

  it('空目录返回空串', () => {
    expect(skillCatalogLines([])).toBe('')
  })
})
