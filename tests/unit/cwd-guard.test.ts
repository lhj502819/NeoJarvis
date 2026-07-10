import { describe, it, expect } from 'vitest'
import { sanitizeCwd } from '../../src/jarvis/cwd-guard.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('sanitizeCwd', () => {
  it('undefined/空/null 返回 undefined', () => {
    expect(sanitizeCwd(undefined)).toBeUndefined()
    expect(sanitizeCwd(null as any)).toBeUndefined()
    expect(sanitizeCwd('')).toBeUndefined()
    expect(sanitizeCwd('   ')).toBeUndefined()
  })

  it('相对路径返回 undefined(歧义太大不放行)', () => {
    expect(sanitizeCwd('./foo')).toBeUndefined()
    expect(sanitizeCwd('foo/bar')).toBeUndefined()
    expect(sanitizeCwd('~/Desktop')).toBeUndefined()
  })

  it('绝对路径但不存在返回 undefined(LLM 幻觉路径的关键防线)', () => {
    expect(sanitizeCwd('/Users/hh/workspace/one-decision-cc')).toBeUndefined()
    expect(sanitizeCwd('/nonexistent-path-xyz-123')).toBeUndefined()
  })

  it('存在的绝对路径原样返回', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cwd-guard-'))
    try {
      expect(sanitizeCwd(tmp)).toBe(tmp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('存在路径的前后空白被 trim', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cwd-guard-'))
    try {
      expect(sanitizeCwd(`  ${tmp}  `)).toBe(tmp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
