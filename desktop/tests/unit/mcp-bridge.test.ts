import { describe, it, expect, beforeEach } from 'vitest'

// 令牌走 env 覆盖,避免测试写 ~/.jarvis
process.env.JARVIS_MCP_TOKEN = 'unit-test-token-0123456789abcdef'

const { verifyBridgeToken } = await import('../../agent/mcp/bridge-token.js')
const { buildMcpMessageLabel } = await import('../../agent/jarvis/routes/mcp-bridge.js')

describe('MCP 桥接令牌', () => {
  it('正确令牌通过,错误/空令牌拒绝', () => {
    expect(verifyBridgeToken('unit-test-token-0123456789abcdef')).toBe(true)
    expect(verifyBridgeToken('wrong')).toBe(false)
    expect(verifyBridgeToken('')).toBe(false)
    expect(verifyBridgeToken(undefined)).toBe(false)
  })
})

describe('MCP 消息标签', () => {
  it('带来源与授权边界提醒', () => {
    const label = buildMcpMessageLabel('Claude Code', '帮我看下任务进度')
    expect(label).toContain('外部 Agent「Claude Code」')
    expect(label).toContain('帮我看下任务进度')
    expect(label).toContain('授权边界')
  })
})
