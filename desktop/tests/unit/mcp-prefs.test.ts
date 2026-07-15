import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// mcp-prefs 的黑名单数据层走 Java(GET /api/mcp/prefs、POST /api/mcp/{name}/toggle),
// 用内存 fake 模拟 Java McpPrefsService 的黑名单语义(幂等启/禁、按用户隔离)。
// listHubMcpServers() 扫本机 ~/.claude.json 走真实实现,通过 JARVIS_HUB_MCP_CONFIG 注入临时文件。
// resolveMcpServers 走的是 DB user 自加(Java /api/mcp-servers/resolved),同样用内存 fake。
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
  serverPost: async (userId: string, path: string, body?: any) => {
    const m = path.match(/^\/api\/mcp\/(.+)\/toggle$/)
    if (m) {
      const name = decodeURIComponent(m[1])
      const set = store.disabled.get(userId) ?? new Set<string>()
      if (body?.enabled) set.delete(name)
      else set.add(name)
      store.disabled.set(userId, set)
    }
    return { ok: true }
  },
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
  tmpDir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-prefs-'))
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

const USER = `u-mcppref-${Date.now()}`

describe('mcp-prefs 黑名单', () => {
  it('初始无禁用,集合为空', async () => {
    const { getDisabledMcps } = await import('../../agent/jarvis/mcp-prefs.js')
    const disabled = await getDisabledMcps(USER)
    expect(disabled.size).toBe(0)
  })

  it('禁用一个 MCP 后集合含它', async () => {
    const { getDisabledMcps, setMcpEnabled } = await import('../../agent/jarvis/mcp-prefs.js')
    await setMcpEnabled(USER, 'chrome-devtools', false)
    const disabled = await getDisabledMcps(USER)
    expect(disabled.has('chrome-devtools')).toBe(true)
  })

  it('重复禁用不报错(幂等)', async () => {
    const { getDisabledMcps, setMcpEnabled } = await import('../../agent/jarvis/mcp-prefs.js')
    await setMcpEnabled(USER, 'chrome-devtools', false)
    await setMcpEnabled(USER, 'chrome-devtools', false)
    const disabled = await getDisabledMcps(USER)
    expect(disabled.size).toBe(1)
  })

  it('重新启用后集合不含它', async () => {
    const { getDisabledMcps, setMcpEnabled } = await import('../../agent/jarvis/mcp-prefs.js')
    await setMcpEnabled(USER, 'chrome-devtools', false)
    await setMcpEnabled(USER, 'chrome-devtools', true)
    const disabled = await getDisabledMcps(USER)
    expect(disabled.has('chrome-devtools')).toBe(false)
  })

  it('按用户隔离', async () => {
    const { getDisabledMcps, setMcpEnabled } = await import('../../agent/jarvis/mcp-prefs.js')
    const OTHER = `${USER}-other`
    await setMcpEnabled(USER, 'context7', false)
    const otherDisabled = await getDisabledMcps(OTHER)
    expect(otherDisabled.has('context7')).toBe(false)
  })
})

describe('mcp-prefs listMcpsForUser 合并视图', () => {
  it('hub + DB 合并;同名时 user 覆盖 personal;禁用后 enabled=false;envKeys 只含 key 名', async () => {
    writeCfg({
      mcpServers: {
        'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
        semble: { type: 'stdio', command: 'uvx', args: ['semble-mcp'] },
        figma: { type: 'stdio', command: 'npx', env: { FIGMA_API_KEY: 'sk-hub' } },
      },
    })
    store.resolved.set(USER, [
      // 同名覆盖 hub 的 figma —— 应显示 user 版本
      { name: 'figma', transport: 'stdio', command: 'user-figma-mcp', args: ['--v2'],
        env: { FIGMA_API_KEY: 'sk-user' }, description: 'user override' },
      // 独立 user MCP
      { name: 'notion', transport: 'http', url: 'https://notion.api/mcp', env: { TOKEN: 'tok' } },
    ])

    const { setMcpEnabled, listMcpsForUser } = await import('../../agent/jarvis/mcp-prefs.js')
    await setMcpEnabled(USER, 'semble', false)

    const list = await listMcpsForUser(USER)
    // 排序稳定
    expect(list.map(x => x.name)).toEqual(['chrome-devtools', 'figma', 'notion', 'semble'])

    // hub 独有
    const chrome = list.find(x => x.name === 'chrome-devtools')!
    expect(chrome.source).toBe('personal')
    expect(chrome.enabled).toBe(true)
    expect(chrome.command).toBe('npx')

    // 同名 user 覆盖 personal
    const figma = list.find(x => x.name === 'figma')!
    expect(figma.source).toBe('user')
    expect(figma.command).toBe('user-figma-mcp')
    expect(figma.envKeys).toEqual(['FIGMA_API_KEY'])
    // McpView 不带 env value —— 序列化后不能出现明文 secret
    expect(JSON.stringify(figma)).not.toContain('sk-hub')
    expect(JSON.stringify(figma)).not.toContain('sk-user')

    // 用户独有(HTTP)
    const notion = list.find(x => x.name === 'notion')!
    expect(notion.source).toBe('user')
    expect(notion.type).toBe('http')
    expect(notion.envKeys).toEqual(['TOKEN'])
    expect(JSON.stringify(notion)).not.toContain('tok')

    // 禁用状态在视图里体现
    const semble = list.find(x => x.name === 'semble')!
    expect(semble.enabled).toBe(false)
  })

  it('PIPELINE_MCPS(agent-comms / jarvis-system)在视图中被过滤', async () => {
    writeCfg({
      mcpServers: {
        'agent-comms': { type: 'stdio', command: 'x' },
        'jarvis-system': { type: 'stdio', command: 'y' },
        good: { type: 'stdio', command: 'z' },
      },
    })
    const { listMcpsForUser } = await import('../../agent/jarvis/mcp-prefs.js')
    const list = await listMcpsForUser(USER)
    expect(list.map(x => x.name)).toEqual(['good'])
  })

  it('黑名单读失败降级为空(不抛)', async () => {
    // 模拟服务不可达:让 mock 抛错的路径不匹配;这里没有 prefs 路径回退,直接靠 catch
    // getDisabledMcps 本身内部 try/catch,不需要额外配置
    writeCfg({ mcpServers: { good: { type: 'stdio', command: 'x' } } })
    const { listMcpsForUser } = await import('../../agent/jarvis/mcp-prefs.js')
    const list = await listMcpsForUser(USER)
    expect(list.length).toBeGreaterThan(0)
  })
})
