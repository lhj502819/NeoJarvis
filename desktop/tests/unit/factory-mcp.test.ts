import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// factory.ts (A2A executor path) 补 MCP + allowedTools 加 mcp__* 后要验证:
//   1. startAgentServer(recipe, userId) 会把 userId 一路传到 RecipeExecutor.execute()
//   2. execute() 调 SDK query 时,options 里带上:
//      - mcpServers = buildUserMcpServers(userId) 的返回(不是空对象/undefined)
//      - allowedTools 包含 recipe.tools + 'mcp__*' 通配
// factory.ts module-level 会 execSync('which claude') + app.listen,通过 vi.mock 全部隔离。
// RecipeExecutor 未导出;通过 mock DefaultRequestHandler 抓取入参里的 executor 实例。

const spies = vi.hoisted(() => ({
  queryCalls: [] as Array<{ prompt: unknown; options: any }>,
  mcpBuilds: [] as string[],
  mcpReturn: {} as Record<string, any>,
  capturedExecutor: null as any,
}))

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execSync: (cmd: string, opts?: any) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        // factory.ts 调用形如 execSync('which claude', { encoding: 'utf-8' }).trim();
        // 保证返回值就是字符串,.trim() 可用
        return '/usr/local/bin/claude\n'
      }
      return actual.execSync(cmd, opts)
    },
  }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (arg: { prompt: unknown; options: any }) => {
    spies.queryCalls.push(arg)
    // 只吐一条成功 result 就结束,executor 的 for-await 循环走完
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok' } as any
    })()
  },
  createSdkMcpServer: (o: any) => o,
  tool: (name: string, desc: string, schema: any, handler: any) => ({ name, desc, schema, handler }),
}))

vi.mock('../../agent/shared/user-mcp.js', () => ({
  buildUserMcpServers: async (userId: string) => {
    spies.mcpBuilds.push(userId)
    return spies.mcpReturn
  },
}))

// Express: 让 app.listen 变 no-op,避免真占端口
vi.mock('express', async () => {
  const fake = () => {
    const app: any = {
      use: () => app,
      listen: (_port: number, cb?: () => void) => { cb?.(); return { close: () => {} } },
    }
    return app
  }
  ;(fake as any).default = fake
  return { default: fake }
})

// A2A SDK: 抓取 executor 引用
vi.mock('@a2a-js/sdk/server', () => ({
  DefaultRequestHandler: class {
    constructor(_card: any, _store: any, executor: any) {
      spies.capturedExecutor = executor
    }
  },
  InMemoryTaskStore: class {},
}))

vi.mock('@a2a-js/sdk/server/express', () => ({
  agentCardHandler: () => (_req: any, _res: any, next: any) => next(),
  jsonRpcHandler: () => (_req: any, _res: any, next: any) => next(),
  restHandler: () => (_req: any, _res: any, next: any) => next(),
  UserBuilder: { noAuthentication: {} },
}))

beforeEach(() => {
  spies.queryCalls.length = 0
  spies.mcpBuilds.length = 0
  spies.mcpReturn = {}
  spies.capturedExecutor = null
  vi.resetModules()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeReq() {
  return {
    taskId: 't-1',
    contextId: 'c-1',
    userMessage: {
      parts: [{ kind: 'text', text: 'do the task' }],
    },
  } as any
}

function makeBus() {
  const events: any[] = []
  return {
    events,
    publish: (e: any) => events.push(e),
    finished: () => events.push({ kind: 'finished' }),
  } as any
}

function makeRecipe(): any {
  return {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-recipe',
    description: 'test',
    systemPrompt: 'you are a test agent',
    tools: ['Read', 'Bash', 'Grep'],
    skills: [],
    model: 'sonnet',
    context: {},
    persistent: true,
    usageCount: 0,
    createdBy: 'builtin',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
}

describe('factory.ts RecipeExecutor 补 MCP + allowedTools 加 mcp__*', () => {
  it('startAgentServer 接收 userId(默认 system),transfer 到 executor;execute() 里用 userId 调 buildUserMcpServers', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')
    spies.mcpReturn = {
      'chrome-devtools': { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp'] },
    }
    const recipe = makeRecipe()

    startAgentServer(recipe, 'u-alice')
    // 确认 executor 已被 A2A SDK 捕获
    expect(spies.capturedExecutor).toBeTruthy()

    await spies.capturedExecutor.execute(makeReq(), makeBus())

    expect(spies.mcpBuilds).toEqual(['u-alice'])
    expect(spies.queryCalls).toHaveLength(1)
    const opts = spies.queryCalls[0].options
    expect(opts.mcpServers).toEqual({
      'chrome-devtools': { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp'] },
    })
  })

  it('allowedTools 里包含 recipe.tools + mcp__* 通配', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')
    const recipe = makeRecipe() // tools = ['Read', 'Bash', 'Grep']

    startAgentServer(recipe, 'u-bob')
    await spies.capturedExecutor.execute(makeReq(), makeBus())

    const opts = spies.queryCalls[0].options
    expect(opts.allowedTools).toContain('Read')
    expect(opts.allowedTools).toContain('Bash')
    expect(opts.allowedTools).toContain('Grep')
    expect(opts.allowedTools).toContain('mcp__*')
  })

  it('buildUserMcpServers 抛错时 mcpServers 降级为空对象,executor 不崩', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')

    // 让 buildUserMcpServers 抛错;测试结束后恢复以免影响后续 test 用例
    const userMcpMod = await import('../../agent/shared/user-mcp.js')
    const original = (userMcpMod as any).buildUserMcpServers
    ;(userMcpMod as any).buildUserMcpServers = async () => { throw new Error('boom') }

    try {
      const recipe = makeRecipe()
      startAgentServer(recipe, 'u-err')
      await spies.capturedExecutor.execute(makeReq(), makeBus())

      const opts = spies.queryCalls[0].options
      expect(opts.mcpServers).toEqual({})
    } finally {
      ;(userMcpMod as any).buildUserMcpServers = original
    }
  })

  it('未传 userId 时默认为 system,仍会调 buildUserMcpServers', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')

    const recipe = makeRecipe()
    startAgentServer(recipe) // 不传 userId
    await spies.capturedExecutor.execute(makeReq(), makeBus())

    expect(spies.mcpBuilds).toEqual(['system'])
  })
})
