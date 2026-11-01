import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// factory.ts (A2A executor path) 迁移到 Pi SDK 后:
//   - query({ mcpServers, allowedTools }) → createAgentSession({ customTools })
//   - Pi 无 MCP / allowedTools 概念,工具走 customTools(ToolDefinition[])
//   - 验证点:
//     1. startAgentServer(recipe, userId) 把 userId 一路传到 RecipeExecutor.execute()
//     2. execute() 里用 userId 调 buildUserMcpServers,返回的 ToolDefinition[] 传给 createAgentSession
//     3. buildUserMcpServers 抛错时 customTools 降级为空数组,executor 不崩
//   factory.ts module-level 会 ModelRuntime.create() + app.listen,通过 vi.mock 全部隔离。
//   RecipeExecutor 未导出;通过 mock DefaultRequestHandler 抓取入参里的 executor 实例。

const spies = vi.hoisted(() => ({
  createSessionCalls: [] as Array<{ customTools?: any[]; cwd?: string }>,
  mcpBuilds: [] as string[],
  mcpReturn: [] as any[],
  capturedExecutor: null as any,
}))

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    // factory.ts 不再 execSync('which claude')(Pi 不需要 claude CLI);保留兼容旧断言
    execSync: (cmd: string, opts?: any) => actual.execSync(cmd, opts),
  }
})

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: async (opts: any) => {
    spies.createSessionCalls.push(opts)
    // 返回一个最小 session mock:prompt 解析后发 agent_end
    const listeners: Array<(e: any) => void> = []
    const session: any = {
      sessionId: 'sess-mock',
      isStreaming: false,
      subscribe: (l: (e: any) => void) => { listeners.push(l); return () => {} },
      prompt: async (_text: string) => {
        // 模拟一轮:agent_end 带 assistant 文本
        for (const l of listeners) {
          l({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] })
        }
      },
      abort: async () => {},
      dispose: () => {},
    }
    return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } }
  },
  DefaultResourceLoader: class {
    constructor(_opts: any) {}
    async reload() {}
  },
  ModelRuntime: { create: async () => ({}) },
  SessionManager: { inMemory: (_cwd?: string) => ({}) },
  SettingsManager: { inMemory: (_opts?: any) => ({}) },
  getAgentDir: () => '/tmp/test-agent-dir',
}))

vi.mock('../../agent/shared/pi-models.js', () => ({
  getModelRuntime: async () => ({}),
  getJarvisModel: async () => ({ provider: 'test', id: 'test-model' }),
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
  spies.createSessionCalls.length = 0
  spies.mcpBuilds.length = 0
  spies.mcpReturn = []
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
    userMessage: { parts: [{ kind: 'text', text: 'do the task' }] },
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

describe('factory.ts RecipeExecutor 迁移到 Pi SDK(createAgentSession + customTools)', () => {
  it('startAgentServer 接收 userId(默认 system),transfer 到 executor;execute() 里用 userId 调 buildUserMcpServers', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')
    spies.mcpReturn = [{ name: 'mcp_tool', label: 'M', description: 'd', parameters: {}, execute: async () => ({ content: [], details: {} }) }]
    const recipe = makeRecipe()

    startAgentServer(recipe, 'u-alice')
    expect(spies.capturedExecutor).toBeTruthy()

    await spies.capturedExecutor.execute(makeReq(), makeBus())

    expect(spies.mcpBuilds).toEqual(['u-alice'])
    expect(spies.createSessionCalls).toHaveLength(1)
    const opts = spies.createSessionCalls[0]
    expect(opts.customTools).toEqual(spies.mcpReturn)
  })

  it('未传 userId 时默认为 system,仍会调 buildUserMcpServers', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')

    const recipe = makeRecipe()
    startAgentServer(recipe) // 不传 userId
    await spies.capturedExecutor.execute(makeReq(), makeBus())

    expect(spies.mcpBuilds).toEqual(['system'])
  })

  it('buildUserMcpServers 抛错时 customTools 降级为空数组,executor 不崩', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')

    const userMcpMod = await import('../../agent/shared/user-mcp.js')
    const original = (userMcpMod as any).buildUserMcpServers
    ;(userMcpMod as any).buildUserMcpServers = async () => { throw new Error('boom') }

    try {
      const recipe = makeRecipe()
      startAgentServer(recipe, 'u-err')
      await spies.capturedExecutor.execute(makeReq(), makeBus())

      const opts = spies.createSessionCalls[0]
      // factory.ts 里 .catch(() => []) 降级,customTools 为空数组
      expect(opts.customTools).toEqual([])
    } finally {
      ;(userMcpMod as any).buildUserMcpServers = original
    }
  })

  it('execute() 返回的 response message 含 assistant 文本(agent_end 提取)', async () => {
    const { startAgentServer } = await import('../../agent/team/factory.js')
    const recipe = makeRecipe()
    startAgentServer(recipe, 'u-text')
    const bus = makeBus()
    await spies.capturedExecutor.execute(makeReq(), bus)

    // bus.events 里应该有 response message + completed status-update + finished
    const responseMsg = bus.events.find((e: any) => e.kind === 'message')
    expect(responseMsg).toBeTruthy()
    expect(responseMsg.parts[0].text).toBe('ok')
    const completed = bus.events.find((e: any) => e.kind === 'status-update' && e.status?.state === 'completed')
    expect(completed).toBeTruthy()
  })
})
