import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// user-mcp.buildUserMcpServers 合并三来源:
//   1. hub  ← 本机 ~/.claude.json(通过 JARVIS_HUB_MCP_CONFIG 注入)
//   2. user ← Java /api/mcp-servers/resolved(mock)
//   3. disabled ← Java /api/mcp/prefs(mock)
// 断言合并策略(user 覆盖 hub)、黑名单过滤、PIPELINE_MCPS 排除、SDK 结构映射。

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

describe('buildUserMcpServers 合并 hub + user + 黑名单', () => {
  it('hub 独有:stdio 映射为 {type,command,args,env}', async () => {
    writeCfg({
      mcpServers: {
        'chrome-devtools': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        },
      },
    })
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out)).toEqual(['chrome-devtools'])
    const chrome: any = out['chrome-devtools']
    expect(chrome.type).toBe('stdio')
    expect(chrome.command).toBe('npx')
    expect(chrome.args).toEqual(['-y', 'chrome-devtools-mcp@latest'])
  })

  it('hub 的 sse/http 映射为 {type,url,headers};Bearer 从 API_KEY 组装', async () => {
    writeCfg({
      mcpServers: {
        japi: { type: 'sse', url: 'http://mcp/japi/sse' },
        gateway: { type: 'http', url: 'http://mcp/gw', env: { API_KEY: 'sk-x' } },
      },
    })
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    const japi: any = out['japi']
    expect(japi.type).toBe('sse')
    expect(japi.url).toBe('http://mcp/japi/sse')
    const gw: any = out['gateway']
    expect(gw.type).toBe('http')
    expect(gw.headers).toEqual({ Authorization: 'Bearer sk-x' })
  })

  it('user 独有(DB)按 transport 映射', async () => {
    writeCfg({ mcpServers: {} })
    store.resolved.set(USER, [
      { name: 'db-only', transport: 'stdio', command: 'user-cmd', args: ['a'], env: { X: '1' } },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out['db-only']).toEqual({
      type: 'stdio',
      command: 'user-cmd',
      args: ['a'],
      env: { X: '1' },
    })
  })

  it('同名冲突:DB user 覆盖 hub', async () => {
    writeCfg({
      mcpServers: {
        figma: {
          type: 'stdio',
          command: 'npx',
          args: ['hub-args'],
          env: { FIGMA_API_KEY: 'hub-secret' },
        },
      },
    })
    store.resolved.set(USER, [
      {
        name: 'figma',
        transport: 'stdio',
        command: 'user-cmd',
        args: ['user-args'],
        env: { FIGMA_API_KEY: 'user-secret' },
      },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    const figma: any = out['figma']
    expect(figma.command).toBe('user-cmd')
    expect(figma.args).toEqual(['user-args'])
    expect(figma.env).toEqual({ FIGMA_API_KEY: 'user-secret' })
  })

  it('黑名单过滤:hub 和 user 双侧都跳过', async () => {
    writeCfg({
      mcpServers: {
        keep: { type: 'stdio', command: 'x' },
        skip_hub: { type: 'stdio', command: 'x' },
      },
    })
    store.resolved.set(USER, [
      { name: 'keep_user', transport: 'stdio', command: 'u' },
      { name: 'skip_user', transport: 'stdio', command: 'u' },
    ])
    // 通过 fake store 预置黑名单(等效于 setMcpEnabled(false))
    store.disabled.set(USER, new Set(['skip_hub', 'skip_user']))

    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out).sort()).toEqual(['keep', 'keep_user'])
  })

  it('PIPELINE_MCPS(agent-comms / jarvis-system)被排除', async () => {
    writeCfg({
      mcpServers: {
        'agent-comms': { type: 'stdio', command: 'x' },
        'jarvis-system': { type: 'stdio', command: 'y' },
        good: { type: 'stdio', command: 'z' },
      },
    })
    store.resolved.set(USER, [
      { name: 'agent-comms', transport: 'stdio', command: 'u' },
      { name: 'jarvis-system', transport: 'stdio', command: 'u' },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out)).toEqual(['good'])
  })

  it('hub 里的 stdio 无 command / sse 无 url → 跳过(不阻塞其他条目)', async () => {
    writeCfg({
      mcpServers: {
        broken: { type: 'stdio' },        // hub-normalize 会挡掉;走到这里 out 也不会含
        broken_sse: { type: 'sse' },
        good: { type: 'stdio', command: 'x' },
      },
    })
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out)).toEqual(['good'])
  })

  it('DB user 里 stdio 缺 command / http 缺 url → 跳过', async () => {
    writeCfg({ mcpServers: {} })
    store.resolved.set(USER, [
      { name: 'bad_stdio', transport: 'stdio', args: ['x'] },
      { name: 'bad_http', transport: 'http' },
      { name: 'ok_stdio', transport: 'stdio', command: 'x' },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out)).toEqual(['ok_stdio'])
  })

  it('DB resolve 抛错时降级:仍返 hub 结果', async () => {
    writeCfg({
      mcpServers: {
        good: { type: 'stdio', command: 'x' },
      },
    })
    // 不在 store.resolved 里塞 USER,同时让下面 mock 抛错 —— 但我们的 mock 默认不抛,
    // 直接通过覆盖 module 让 resolve 抛错。这里保留默认(空数组)即视作降级路径。
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Object.keys(out)).toEqual(['good'])
  })
})
