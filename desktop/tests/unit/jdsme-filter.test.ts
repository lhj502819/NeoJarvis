import { describe, it, expect } from 'vitest'
import { isGroupAllowed } from '../../agent/events/sources/jdsme-filter.js'

describe('isGroupAllowed', () => {
  it('白名单为空 = 放行全部群', () => {
    expect(isGroupAllowed('any-group', [])).toBe(true)
  })

  it('配置了白名单 = 只放行列出的群', () => {
    expect(isGroupAllowed('g1', ['g1', 'g2'])).toBe(true)
    expect(isGroupAllowed('g3', ['g1', 'g2'])).toBe(false)
  })
})
