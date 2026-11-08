import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'node:url'

// user-mcp.buildUserMcpServers(P6 桥接已实装):
//   三来源合并(同名 DB 覆盖 hub)+ 黑名单,每 stdio server 桥接为一个代理工具
//   (mcp_<name>,发现式调用)。本文件验证合并语义与各种异常的降级;
//   协议层交互的集成测试在 user-mcp-bridge.test.ts(真实 spawn mock server)。

const store = vi.hoisted(() => ({
  disabled: new Map<string, Set<string>>(),
  resolved: new Map<string, any[]>(),
}))

vi.mock('../../agent/shared/server-client.js', () => ({
  serverGet: async (userId: string, path: string) => {
    if (path === '/api/mcp/prefs') {
      return { code: 0, disabled: [...(store.disabled.get(userId) ?? [])] }
    }
    if (path === '/api/mcp-servers/resolved') {
      return store.resolved.get(userId) ?? []
    }
    return {}
  },
  serverPost: async () => ({ ok: true }),
  serverPatch: async () => ({ ok: true }),
  serverDelete: async () => ({ ok: true }),
  serverPut: async () => ({ ok: true }),
}))

let tmpDir: string
let cfgPath: string
const origEnv = process.env.JARVIS_HUB_MCP_CONFIG

function writeCfg(obj: unknown): void {
  writeFileSync(cfgPath, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8')
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jarvis-user-mcp-'))
  cfgPath = join(tmpDir, 'claude.json')
  process.env.JARVIS_HUB_MCP_CONFIG = cfgPath
  store.disabled.clear()
  store.resolved.clear()
})

afterEach(() => {
  if (origEnv === undefined) delete process.env.JARVIS_HUB_MCP_CONFIG
  else process.env.JARVIS_HUB_MCP_CONFIG = origEnv
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

const USER = `u-user-mcp-${Date.now()}`

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/mock-mcp-server.mjs')

describe('buildUserMcpServers 三来源合并与降级(P6 桥接)', () => {
  it('同名时 DB user 覆盖 hub:桥接的是 DB 配的命令', async () => {
    // hub 配一个坏命令,DB 同名配好命令(真实可 spawn)——DB 必须胜出
    writeCfg({ mcpServers: { fixture: { type: 'stdio', command: '/definitely/not/exist' } } })
    store.resolved.set(USER, [
      { name: 'fixture', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('mcp_fixture')
    const listed = await out[0].execute('call-1', {})
    expect(listed.content[0].text).toContain('echo')   // 坏命令胜出的话这里拿不到工具清单
  }, 20_000)

  it('hub 读取异常时不抛错,DB 部分照常桥接', async () => {
    process.env.JARVIS_HUB_MCP_CONFIG = join(tmpDir, 'nonexistent.json')
    store.resolved.set(USER, [
      { name: 'fixture', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('mcp_fixture')
  }, 20_000)

  it('sse/http 型 server 跳过不崩(stdio 照常)', async () => {
    writeCfg({ mcpServers: {} })
    store.resolved.set(USER, [
      { name: 'remote', transport: 'sse', url: 'http://example.invalid/mcp/sse' },
      { name: 'fixture', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('mcp_fixture')
  }, 20_000)

  it('黑名单命中的 server 不桥接', async () => {
    writeCfg({ mcpServers: {} })
    store.resolved.set(USER, [
      { name: 'blocked', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
      { name: 'fixture', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
    ])
    store.disabled.set(USER, new Set(['blocked']))
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('mcp_fixture')
  }, 20_000)
})
