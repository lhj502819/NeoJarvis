import { describe, it, expect } from 'vitest'
import { toImageContents } from '../../agent/jarvis/image-content.js'

describe('toImageContents', () => {
  it('无图片返回 undefined', () => {
    expect(toImageContents()).toBeUndefined()
    expect(toImageContents([])).toBeUndefined()
  })

  it('转成 Pi 的 { type, data, mimeType } 形状', () => {
    expect(toImageContents([{ mediaType: 'image/png', data: 'AAA' }])).toEqual([
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ])
  })

  it('保持图片顺序', () => {
    const out = toImageContents([
      { mediaType: 'image/png', data: 'A' },
      { mediaType: 'image/jpeg', data: 'B' },
    ])
    expect(out?.map(i => i.mimeType)).toEqual(['image/png', 'image/jpeg'])
  })
})
