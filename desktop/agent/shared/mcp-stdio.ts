import { spawn, type ChildProcess } from 'node:child_process'

/**
 * 最小 MCP stdio 客户端(superagent-v2 P6 基建):
 * JSON-RPC 2.0 over stdio,换行分帧(MCP 规范)。只实现桥接需要的三步——
 * initialize → tools/list → tools/call;不支持的 server 能力(资源/提示)忽略。
 *
 * 进程共享:同(serverKey)的客户端全局复用 —— Jarvis think 与每个小弟会话都会
 * 调 buildUserMcpServers,不共享会为每次思考重复 spawn。空闲 10 分钟由 reaper 回收。
 */

const PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'jarvis-mcp-bridge', version: '1.0.0' }
const IDLE_KILL_MS = 10 * 60_000

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpCallResult {
  text: string
  isError: boolean
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export interface StdioServerSpec {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export class McpStdioClient {
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private started = false
  private starting: Promise<void> | null = null
  lastUsed = Date.now()   // reaper 判空闲用
  private toolInfos: McpToolInfo[] | null = null

  constructor(readonly spec: StdioServerSpec) {}

  /** 进程存活且可用 */
  get alive(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  private async ensureStarted(): Promise<void> {
    if (this.alive && this.started) return
    if (this.starting) return this.starting
    this.starting = this.doStart()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async doStart(): Promise<void> {
    this.buffer = ''
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('MCP server 重启中')) })
    this.pending.clear()
    const child = spawn(this.spec.command, this.spec.args ?? [], {
      env: { ...process.env, ...(this.spec.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => this.onData(chunk))
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (line) console.debug(`[mcp:${this.spec.name}] ${line.slice(0, 200)}`)
    })
    child.on('error', (err) => {
      // spawn ENOENT 等启动失败走异步 error 事件,不接会以未捕获异常打崩进程
      console.error(`[mcp:${this.spec.name}] 进程错误: ${err.message}`)
      this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error(`MCP server 启动失败: ${err.message}`.slice(0, 300))) })
      this.pending.clear()
      this.child = null
      this.started = false
      this.toolInfos = null
    })
    child.on('exit', (code) => {
      console.warn(`[mcp:${this.spec.name}] 进程退出 code=${code}`)
      this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error(`MCP server 已退出(${code})`)) })
      this.pending.clear()
      this.child = null
      this.started = false
      this.toolInfos = null
    })

    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, 15_000)
    this.notify('notifications/initialized')
    this.started = true
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg: any
      try { msg = JSON.parse(line) } catch { /* 非 JSON 行忽略(server 日志混入 stdout) */ continue }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(`MCP 错误 ${msg.error.code}: ${msg.error.message ?? ''}`.slice(0, 300)))
        else p.resolve(msg.result)
      }
      // notification(无 id)忽略:server 的日志通知不打扰主流程
    }
  }

  private async request(method: string, params: unknown, timeoutMs = 60_000): Promise<any> {
    if (!this.alive) throw new Error('MCP server 进程未运行')
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时(${timeoutMs}ms)`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin!.write(payload + '\n')
    })
  }

  private notify(method: string, params?: unknown): void {
    if (!this.alive) return
    this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n')
  }

  /** 工具清单(带缓存;server 重启后自动失效重拉) */
  async listTools(): Promise<McpToolInfo[]> {
    this.lastUsed = Date.now()
    await this.ensureStarted()
    if (!this.toolInfos) {
      const result = await this.request('tools/list', {}, 30_000)
      const infos = Array.isArray(result?.tools) ? result.tools : []
      this.toolInfos = infos
      return infos
    }
    return this.toolInfos
  }

  /** 调用工具;文本内容扁平化为字符串(isError 语义保留) */
  async callTool(toolName: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<McpCallResult> {
    this.lastUsed = Date.now()
    await this.ensureStarted()
    const result = await this.request('tools/call', { name: toolName, arguments: args ?? {} }, timeoutMs)
    const parts = Array.isArray(result?.content) ? result.content : []
    const text = parts
      .map((c: any) => c?.type === 'text' ? String(c.text ?? '') : `[${c?.type ?? 'unknown'}]`)
      .join('\n')
    return { text, isError: !!result?.isError }
  }

  stop(): void {
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('MCP client 已停止')) })
    this.pending.clear()
    if (this.alive) this.child!.kill()
    this.child = null
    this.started = false
    this.toolInfos = null
  }
}

// ── 全局共享池(按 server spec 键复用,空闲回收) ──

const pool = new Map<string, McpStdioClient>()
let reaperStarted = false

function serverKey(spec: StdioServerSpec): string {
  return `${spec.name}|${spec.command}|${(spec.args ?? []).join(' ')}`
}

/** 取(或建)该 server 的共享客户端;全局唯一,空闲 10 分钟自动回收进程。 */
export function retainMcpClient(spec: StdioServerSpec): McpStdioClient {
  const key = serverKey(spec)
  let client = pool.get(key)
  if (!client || !client.alive) {
    client?.stop()
    client = new McpStdioClient(spec)
    pool.set(key, client)
  }
  if (!reaperStarted) {
    reaperStarted = true
    setInterval(() => {
      const now = Date.now()
      for (const [k, c] of pool) {
        if (now - c.lastUsed > IDLE_KILL_MS) {
          c.stop()
          pool.delete(k)
          console.log(`[mcp] 空闲回收: ${k.split('|')[0]}`)
        }
      }
    }, 60_000).unref()
  }
  return client
}
