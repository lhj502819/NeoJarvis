import { describe, it, expect } from 'vitest'
import { looksLikeRequest } from '../../agent/events/triage-filter.js'

describe('looksLikeRequest', () => {
  it('直接提问/请求不应被当噪音', () => {
    expect(looksLikeRequest('你能收到消息吗')).toBe(true)
    expect(looksLikeRequest('帮我查下周三去上海的高铁')).toBe(true)
    expect(looksLikeRequest('你能干啥')).toBe(true)
    expect(looksLikeRequest('收到请回复')).toBe(true)
    expect(looksLikeRequest('1')).toBe(true)
  })

  it('纯寒暄/表情/无意义内容仍交给 LLM 分诊', () => {
    expect(looksLikeRequest('')).toBe(false)
    expect(looksLikeRequest('哈哈哈')).toBe(false)
    expect(looksLikeRequest('谢谢')).toBe(false)
    expect(looksLikeRequest('👍')).toBe(false)
  })
})
