import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendJdMe } from '../../agent/events/sources/jdsme.js'

/**
 * sendJdMe 是事件源模块的主动发送口(工具 send_jdme 的底层)。
 * 事件源未初始化(无凭证)时必须返回 false,而不是抛错——工具层要靠这个布尔给 Jarvis 可读的失败说明。
 */

describe('sendJdMe', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('事件源未启用(无凭证)时返回 false,不抛错', async () => {
    // 本测试进程没有 initJdMeSource,client 必然为 null
    const ok = await sendJdMe('group', '123', 'hello')
    expect(ok).toBe(false)
  })
})
