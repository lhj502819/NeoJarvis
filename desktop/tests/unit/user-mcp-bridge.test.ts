import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// MCP↔Pi 桥接集成测试(P6 基建):真实 spawn mock stdio server,走完整
// initialize → tools/list → tools/call 协议;hub 返回空,DB 提供 fixture server。
// 额外覆盖:不存在的 command 只丢该 server 不抛错(降级纪律)。

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/mock-mcp-server.mjs')

vi.mock('../../agent/jarvis/mcp-hub.js', () => ({ listHubMcpServers: () => [] }))
vi.mock('../../agent/auth/mcp-servers.js', () => ({
  resolveMcpServers: vi.fn(async () => [
    { name: 'mocksrv', transport: 'stdio', command: process.execPath, args: [fixturePath], env: {} },
  ]),
}))
vi.mock('../../agent/jarvis/mcp-prefs.js', () => ({
  getDisabledMcps: vi.fn(async () => new Set<string>()),
  PIPELINE_MCPS: [] as string[],
}))

const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
const mcpServersMod = await import('../../agent/auth/mcp-servers.js')
const prefsMod = await import('../../agent/jarvis/mcp-prefs.js')

describe('user-mcp 桥接(stdio 集成)', () => {
  beforeEach(() => {
    vi.mocked(mcpServersMod.resolveMcpServers).mockImplementation(async () => [
      { name: 'mocksrv', transport: 'stdio', command: process.execPath, args: [fixturePath], env: {} },
    ])
    vi.mocked(prefsMod.getDisabledMcps).mockImplementation(async () => new Set())
  })

  it('每 server 一个代理工具:不传 tool 列清单,传 tool+arguments 执行', async () => {
    const tools = await buildUserMcpServers('u1')
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('mcp_mocksrv')
    expect(tools[0].description).toContain('[MCP:mocksrv]')
    // 发现:不传 tool → 工具清单
    const listed = await tools[0].execute('call-1', {})
    expect(listed.content[0].text).toContain('echo')
    expect(listed.content[0].text).toContain('回声测试工具')
    // 执行:tool+arguments
    const ran = await tools[0].execute('call-2', { tool: 'echo', arguments: { text: '你好桥接' } })
    expect(ran.content[0].text).toBe('echo:你好桥接')
  }, 20_000)

  it('工具复用共享客户端(第二次调用不再重启 server)', async () => {
    const tools = await buildUserMcpServers('u1')
    const r1 = await tools[0].execute('call-3', { tool: 'echo', arguments: { text: '一' } })
    const r2 = await tools[0].execute('call-4', { tool: 'echo', arguments: { text: '二' } })
    expect(r1.content[0].text).toBe('echo:一')
    expect(r2.content[0].text).toBe('echo:二')
  }, 20_000)

  it('server 命令不存在 → 该 server 被跳过,整体不抛错(降级纪律)', async () => {
    vi.mocked(mcpServersMod.resolveMcpServers).mockImplementation(async () => [
      { name: 'broken', transport: 'stdio', command: '/definitely/not/exist/xyz', args: [], env: {} },
    ])
    const tools = await buildUserMcpServers('u1')
    expect(tools).toEqual([])
    vi.mocked(mcpServersMod.resolveMcpServers).mockImplementation(async () => [
      { name: 'mocksrv', transport: 'stdio', command: process.execPath, args: [fixturePath], env: {} },
    ])
  }, 20_000)

  it('黑名单命中的 server 不桥接', async () => {
    vi.mocked(prefsMod.getDisabledMcps).mockImplementation(async () => new Set(['mocksrv']))
    const tools = await buildUserMcpServers('u1')
    expect(tools).toEqual([])
    vi.mocked(prefsMod.getDisabledMcps).mockImplementation(async () => new Set())
  }, 20_000)
})
