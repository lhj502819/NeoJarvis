import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// user-mcp.buildUserMcpServers 迁移说明:
//   Claude Agent SDK 原生支持 MCP(query({ mcpServers })),Pi 设计哲学是 No MCP。
//   本次迁移把 buildUserMcpServers 降级为返回 ToolDefinition[](空数组),
//   保证 llm.ts / client.ts / factory.ts 主流程不崩。完整 MCP 桥接待后续 extension 补齐。
//
//   旧测试断言的是 Record<string, McpServerConfig> 的三来源合并(hub + DB + 黑名单),
//   现在合并逻辑只用于视图层(mcp-hub.ts / mcp-prefs.ts),不再参与运行时工具组装。
//   新测试验证:① 降级返回空数组 ② 任何来源异常都不抛错。

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

describe('buildUserMcpServers 迁移降级(Pi SDK: No MCP)', () => {
  it('降级期:无论 hub/DB 配置如何,返回空 ToolDefinition[](不崩主流程)', async () => {
    writeCfg({
      mcpServers: {
        'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      },
    })
    store.resolved.set(USER, [
      { name: 'db-only', transport: 'stdio', command: 'user-cmd' },
    ])
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toEqual([])
  })

  it('hub 读取异常时不抛错,仍返回空数组', async () => {
    // 配置文件不存在 → listHubMcpServers 会抛,buildUserMcpServers 内部 catch
    process.env.JARVIS_HUB_MCP_CONFIG = join(tmpDir, 'nonexistent.json')
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toEqual([])
  })

  it('DB resolve 抛错时不抛错,返回空数组', async () => {
    writeCfg({ mcpServers: {} })
    // 通过不预置 resolved 让 mock 返回空(等效降级路径)
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toEqual([])
  })

  it('黑名单读取异常时不抛错,返回空数组', async () => {
    writeCfg({ mcpServers: { good: { type: 'stdio', command: 'x' } } })
    const { buildUserMcpServers } = await import('../../agent/shared/user-mcp.js')
    const out = await buildUserMcpServers(USER)
    expect(out).toEqual([])
  })

  // TODO(MCP-bridge): 用 Pi extension 实现完整 MCP 桥接后,恢复以下合并逻辑测试:
  //   - hub 独有 / sse-http 映射 / DB user 覆盖 hub / 黑名单过滤 / PIPELINE_MCPS 排除
  //   - 缺字段跳过 / 降级路径
  // 届时 buildUserMcpServers 返回 ToolDefinition[],每个 MCP server 的工具动态发现。
})
