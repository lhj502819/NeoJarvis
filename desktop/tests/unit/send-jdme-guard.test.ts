import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createJarvisTools } from '../../agent/jarvis/tools.js'
import { setCurrentOrigin } from '../../agent/jarvis/task-origin.js'

const USER = 'u-send-jdme'

/**
 * send_jdme 的发送决策交给 Jarvis 自己(prompt 讲清机制,不设程序拦截):
 * 群里来信场景下用不用这个工具,由它根据工具描述判断;这里只锁非决策类行为——
 * 空文本拒绝、真发送路径、失败文案。
 */
describe('send_jdme 基础行为(发送决策不做程序拦截)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    setCurrentOrigin(null)
    vi.restoreAllMocks()
  })

  function findTool() {
    const tool = createJarvisTools(USER).find(t => t.name === 'send_jdme')
    if (!tool) throw new Error('send_jdme 工具不存在')
    return tool
  }

  it('同一聊天也不程序拦截(决策在 LLM):origin 匹配时仍走发送路径', async () => {
    setCurrentOrigin({ kind: 'group', chatId: '10236132771', chatName: '测试群' })
    const tool = findTool()
    // client 未初始化 → sendJdMe 返回 false → 文案是"未启用",不是拒绝双发的提示
    const result = await tool.execute('call-1', { kind: 'group', chatId: '10236132771', text: '收到,已办。' }, undefined, undefined, {} as never)
    const text = result.content.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    expect(text).toContain('未启用')
  })

  it('空文本 → 不发送,提示为空', async () => {
    const tool = findTool()
    const result = await tool.execute('call-2', { kind: 'group', chatId: 'x', text: '   ' }, undefined, undefined, {} as never)
    const text = result.content.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    expect(text).toContain('为空')
  })

  it('工具描述讲清了自动回信机制,供 LLM 自行判断', () => {
    const tool = findTool()
    expect(tool.description).toContain('自动送回')
    expect(tool.description).toContain('由你判断')
  })
})
