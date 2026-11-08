import { describe, it, expect } from 'vitest'
import { evaluatePromotionCandidates } from '../../agent/jarvis/promotion-watch.js'

describe('evaluatePromotionCandidates — 转正巡检判定', () => {
  it('达线(≥3 次)且无同名正式小弟、未提醒过 → 提醒', () => {
    const ready = evaluatePromotionCandidates(
      [{ domain: '技术调研', taskCount: 4 }, { domain: 'PRD开发', taskCount: 6 }],
      new Set(['PRD开发']), // PRD开发已有正式小弟(小谱)
      new Set(),
    )
    expect(ready).toEqual(['技术调研'])
  })

  it('不足 3 次不提醒', () => {
    const ready = evaluatePromotionCandidates(
      [{ domain: '技术调研', taskCount: 2 }],
      new Set(),
      new Set(),
    )
    expect(ready).toEqual([])
  })

  it('已有同名 domain 正式小弟 → 不再提醒', () => {
    const ready = evaluatePromotionCandidates(
      [{ domain: 'PRD开发', taskCount: 6 }],
      new Set(['PRD开发']),
      new Set(),
    )
    expect(ready).toEqual([])
  })

  it('已提醒过的 domain 不重复提醒', () => {
    const ready = evaluatePromotionCandidates(
      [{ domain: '技术调研', taskCount: 4 }],
      new Set(),
      new Set(['u1:技术调研'.split(':')[1]]),
    )
    expect(ready).toEqual([])
  })
})
