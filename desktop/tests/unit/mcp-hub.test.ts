import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listHubMcpServers, readClaudeMcpConfig } from '../../agent/jarvis/mcp-hub.js'

// 用临时文件 + JARVIS_HUB_MCP_CONFIG 环境变量注入,避免污染用户真实 ~/.claude.json
let tmpDir: string
let cfgPath: string
const origEnv = process.env.JARVIS_HUB_MCP_CONFIG

function writeCfg(obj: unknown | string): void {
  writeFileSync(cfgPath, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8')
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-hub-'))
  cfgPath = join(tmpDir, 'claude.json')
  process.env.JARVIS_HUB_MCP_CONFIG = cfgPath
})

afterEach(() => {
  if (origEnv === undefined) delete process.env.JARVIS_HUB_MCP_CONFIG
  else process.env.JARVIS_HUB_MCP_CONFIG = origEnv
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('mcp-hub listHubMcpServers', () => {
  it('文件不存在 → 返回空数组,不抛', () => {
    // 不写文件,直接读
    expect(listHubMcpServers()).toEqual([])
  })

  it('文件存在但无 mcpServers 段 → 空数组', () => {
    writeCfg({ numStartups: 1, otherStuff: {} })
    expect(listHubMcpServers()).toEqual([])
  })

  it('JSON 损坏 → 不抛,返回空数组', () => {
    writeCfg('{not valid json,,,')
    expect(listHubMcpServers()).toEqual([])
  })

  it('mcpServers 段是数组而非对象 → 空数组(防御)', () => {
    writeCfg({ mcpServers: ['bad'] })
    expect(listHubMcpServers()).toEqual([])
  })

  it('12 条正常配置:stdio + sse + http 三种类型都能解析,type/command/args/env/url 保留', () => {
    writeCfg({
      mcpServers: {
        // stdio 无 env
        context7: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
        'chrome-devtools': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        },
        // stdio 带 env
        'Framelink-Figma-MCP': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'figma-developer-mcp', '--figma-api-key=YOUR_KEY'],
          env: { FIGMA_API_KEY: 'secret-value' },
        },
        obsidian: {
          type: 'stdio',
          command: '/Users/foo/.nvm/bin/obsidian-mcp',
        },
        semble: {
          type: 'stdio',
          command: 'uvx',
          args: ['semble-mcp'],
        },
        // sse
        'japi-api-docs': {
          type: 'sse',
          url: 'http://mcp-gateway.jd.com/mcp/japi-api-docs-mcp/sse',
        },
        one_knowledge: {
          type: 'sse',
          url: 'http://mcp-gateway.jd.com/mcp/one_knowledge/sse',
        },
        dongDDDTrd: {
          type: 'sse',
          url: 'http://mcp-gateway.jd.com/mcp/DongDDD-CC/sse',
        },
        jsDocumentRead: {
          type: 'sse',
          url: 'http://dongmcp.jd.com/mcp/foo/sse',
        },
        'Deco-prod-mcp': {
          type: 'sse',
          url: 'http://mcp-gateway.jd.com/mcp/deco-mcp-server-prod/sse',
        },
        // http
        utools: {
          type: 'http',
          url: 'http://127.0.0.1:3501/mcp',
        },
        // type 缺失,只有 command(现实中的 "dong" 就是这样)
        dong: {
          command: 'dong',
          args: ['mcp'],
        },
      },
    })

    const list = listHubMcpServers()
    expect(list).toHaveLength(12)

    // 按 name 排序稳定输出
    const names = list.map(s => s.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

    // 每条都是 personal 来源
    for (const s of list) expect(s.source).toBe('personal')

    // stdio + args 保留
    const context7 = list.find(s => s.name === 'context7')!
    expect(context7.type).toBe('stdio')
    expect(context7.command).toBe('npx')
    expect(context7.args).toEqual(['-y', '@upstash/context7-mcp'])
    expect(context7.url).toBeUndefined()
    expect(context7.env).toBeUndefined()

    // stdio + env 保留
    const figma = list.find(s => s.name === 'Framelink-Figma-MCP')!
    expect(figma.type).toBe('stdio')
    expect(figma.env).toEqual({ FIGMA_API_KEY: 'secret-value' })
    expect(figma.args).toEqual(['-y', 'figma-developer-mcp', '--figma-api-key=YOUR_KEY'])

    // stdio 无 args 时 args 字段可无
    const obsidian = list.find(s => s.name === 'obsidian')!
    expect(obsidian.type).toBe('stdio')
    expect(obsidian.command).toBe('/Users/foo/.nvm/bin/obsidian-mcp')

    // sse url 保留,不出现 command/args
    const japi = list.find(s => s.name === 'japi-api-docs')!
    expect(japi.type).toBe('sse')
    expect(japi.url).toBe('http://mcp-gateway.jd.com/mcp/japi-api-docs-mcp/sse')
    expect(japi.command).toBeUndefined()
    expect(japi.args).toBeUndefined()

    // http url 保留
    const utools = list.find(s => s.name === 'utools')!
    expect(utools.type).toBe('http')
    expect(utools.url).toBe('http://127.0.0.1:3501/mcp')

    // type 缺失但有 command → 兼容为 stdio
    const dong = list.find(s => s.name === 'dong')!
    expect(dong.type).toBe('stdio')
    expect(dong.command).toBe('dong')
    expect(dong.args).toEqual(['mcp'])
  })

  it('type 缺失 + 无 command 无 url → 跳过', () => {
    writeCfg({
      mcpServers: {
        bogus: { foo: 'bar' },
        good: { type: 'stdio', command: 'x' },
      },
    })
    const list = listHubMcpServers()
    expect(list.map(s => s.name)).toEqual(['good'])
  })

  it('stdio 无 command → 跳过', () => {
    writeCfg({
      mcpServers: {
        broken_stdio: { type: 'stdio', args: ['x'] },
        ok_stdio: { type: 'stdio', command: 'good' },
      },
    })
    const list = listHubMcpServers()
    expect(list.map(s => s.name)).toEqual(['ok_stdio'])
  })

  it('sse/http/ws 无 url → 跳过', () => {
    writeCfg({
      mcpServers: {
        broken_sse: { type: 'sse' },
        broken_http: { type: 'http' },
        broken_ws: { type: 'ws' },
        ok_sse: { type: 'sse', url: 'http://x' },
      },
    })
    const list = listHubMcpServers()
    expect(list.map(s => s.name)).toEqual(['ok_sse'])
    expect(list[0].url).toBe('http://x')
  })

  it('args 里混入非字符串会被过滤,不整条丢弃', () => {
    writeCfg({
      mcpServers: {
        mixed: { type: 'stdio', command: 'npx', args: ['-y', 123, 'foo', null] },
      },
    })
    const list = listHubMcpServers()
    expect(list).toHaveLength(1)
    expect(list[0].args).toEqual(['-y', 'foo'])
  })

  it('env 里非字符串值被过滤;env 空对象则不带 env 字段', () => {
    writeCfg({
      mcpServers: {
        stripenv: { type: 'stdio', command: 'x', env: { A: '1', B: 2 as unknown as string } },
        emptyenv: { type: 'stdio', command: 'y', env: {} },
      },
    })
    const list = listHubMcpServers()
    const strip = list.find(s => s.name === 'stripenv')!
    expect(strip.env).toEqual({ A: '1' })
    const empty = list.find(s => s.name === 'emptyenv')!
    expect(empty.env).toBeUndefined()
  })

  it('readClaudeMcpConfig(path) 独立可用于测试注入,失败返 null', () => {
    // 目标路径不存在
    expect(readClaudeMcpConfig(join(tmpDir, 'nope.json'))).toBeNull()
    // 坏 JSON
    writeCfg('{broken')
    expect(readClaudeMcpConfig(cfgPath)).toBeNull()
    // 正常
    writeCfg({ mcpServers: { a: { type: 'stdio', command: 'x' } } })
    const raw = readClaudeMcpConfig(cfgPath)
    expect(raw).toMatchObject({ mcpServers: { a: { type: 'stdio', command: 'x' } } })
  })
})
