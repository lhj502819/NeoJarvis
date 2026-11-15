#!/usr/bin/env node
/**
 * Jarvis MCP 桥接 server(stdio,零依赖)。
 *
 * 给 Claude Code / Codex 这类只会说 MCP 的外部 agent 一个给 Jarvis 发消息的入口:
 *   工具 message_jarvis  → 异步投递(回复出现在 Jarvis 聊天流)
 *   工具 ask_jarvis      → 同步提问并等待回复
 *
 * 底层转成 Jarvis 内部 API(POST /api/mcp/message),用本机令牌鉴权:
 *   ~/.jarvis/mcp-token(与 Jarvis 服务端共用;env JARVIS_MCP_TOKEN 可覆盖)
 *
 * 接入方式(以 Claude Code 为例):
 *   claude mcp add jarvis -- node /path/to/desktop/agent/mcp/jarvis-server.mjs
 * Codex 在 ~/.codex/config.toml:
 *   [mcp_servers.jarvis]
 *   command = "node"
 *   args = ["/path/to/desktop/agent/mcp/jarvis-server.mjs"]
 *
 * stdout 只走 JSON-RPC 协议,日志一律 stderr。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const BASE = (process.env.JARVIS_MCP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const TOKEN_PATH = join(homedir(), '.jarvis', 'mcp-token')

function readToken() {
  const fromEnv = String(process.env.JARVIS_MCP_TOKEN || '').trim()
  if (fromEnv) return fromEnv
  try {
    if (!existsSync(TOKEN_PATH)) return ''
    return readFileSync(TOKEN_PATH, 'utf8').trim()
  } catch {
    return ''
  }
}

async function callBridge(path, body, method = 'POST') {
  const token = readToken()
  if (!token) {
    throw new Error(`找不到 MCP 令牌 ${TOKEN_PATH} —— 先启动一次 Jarvis(首次会生成),或在环境变量里设置 JARVIS_MCP_TOKEN`)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-jarvis-mcp-token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`连不上 Jarvis(${BASE}):${err?.message || err}。确认 Jarvis 桌面端/智能层已启动。`)
  }
  const raw = await res.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { /* 非 JSON 响应 */ }
  if (!res.ok) throw new Error(data?.error || `Jarvis 返回 HTTP ${res.status}`)
  return data
}

const TOOLS = [
  {
    name: 'message_jarvis',
    description: '给 Jarvis 发一条消息(异步)。Jarvis 会按它自己的岗位纪律处理:能直接答就答,要干活就派小弟;回复会出现在 Jarvis 聊天流里。适合"知会一声""让它去做一件事"。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要对 Jarvis 说的内容' },
        from: { type: 'string', description: '发件工具名(如 "Claude Code"),帮助 Jarvis 识别来源' },
      },
      required: ['text'],
    },
  },
  {
    name: 'check_jarvis_reply',
    description: '查询 message_jarvis 异步投递的回复。传入 message_jarvis 返回的 msgId;返回状态:处理中 / 已完成(reply) / 已过期(等不到了) / 未知 id。可以隔一会儿多查几次。',
    inputSchema: {
      type: 'object',
      properties: {
        msgId: { type: 'string', description: 'message_jarvis 返回的 msgId' },
      },
      required: ['msgId'],
    },
  },
  {
    name: 'ask_jarvis',
    description: '向 Jarvis 提问并等待回复(同步)。适合需要它给出结论/状态/建议时。注意它会走完整思考链路,可能需要数秒到几十秒;超时会返回"仍在处理"。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问 Jarvis 的问题' },
        from: { type: 'string', description: '发件工具名(如 "Claude Code")' },
        timeoutSeconds: { type: 'number', description: '等待上限(秒,默认 120,最大 300)' },
      },
      required: ['question'],
    },
  },
]

async function callTool(name, args) {
  const from = typeof args?.from === 'string' && args.from.trim() ? args.from.trim().slice(0, 40) : 'MCP Agent'
  if (name === 'message_jarvis') {
    const text = String(args?.text ?? '').trim()
    if (!text) throw new Error('text 不能为空')
    const r = await callBridge('/api/mcp/message', { text, from, wait: false })
    return `已送达 Jarvis(msgId: ${r.msgId || '?'})。稍后用 check_jarvis_reply 传入该 msgId 取回复;回复同时会出现在 Jarvis 聊天流。`
  }
  if (name === 'check_jarvis_reply') {
    const msgId = String(args?.msgId ?? '').trim()
    if (!msgId) throw new Error('msgId 不能为空')
    let r
    try {
      r = await callBridge(`/api/mcp/reply/${encodeURIComponent(msgId)}`, undefined, 'GET')
    } catch (err) {
      if (String(err?.message || '').includes('没有这个 msgId')) return '未知 msgId:没有查到这条消息的回复记录。'
      throw err
    }
    if (r.status === 'done') return r.reply || '(空回复)'
    if (r.status === 'pending') return '仍在处理中,请稍后再查。'
    if (r.status === 'expired') return '等待已过期(Jarvis 可能重启过或处理时间过长),请重新用 message_jarvis 投递或直接用 ask_jarvis。'
    return `状态:${r.status || '未知'}`
  }
  if (name === 'ask_jarvis') {
    const text = String(args?.question ?? '').trim()
    if (!text) throw new Error('question 不能为空')
    const r = await callBridge('/api/mcp/message', { text, from, wait: true, timeoutSeconds: args?.timeoutSeconds })
    return r.reply || r.note || '(无回复)'
  }
  throw new Error(`未知工具:${name}`)
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

async function handleRequest(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'jarvis-bridge', version: '0.1.0' },
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call': {
      const name = msg.params?.name
      try {
        const text = await callTool(name, msg.params?.arguments || {})
        return { content: [{ type: 'text', text }] }
      } catch (err) {
        // 工具执行失败按 MCP 约定走 result.isError,让调用方看到文本原因
        return { content: [{ type: 'text', text: String(err?.message || err) }], isError: true }
      }
    }
    default:
      throw new Error(`未支持的方法:${String(msg.method)}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try { msg = JSON.parse(trimmed) } catch {
    process.stderr.write(`[jarvis-bridge] 忽略非 JSON 行: ${trimmed.slice(0, 120)}\n`)
    return
  }
  // 通知(无 id)不需要应答
  if (msg.id === undefined || msg.id === null) return
  void (async () => {
    try {
      const result = await handleRequest(msg)
      send({ jsonrpc: '2.0', id: msg.id, result })
    } catch (err) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err?.message || err) } })
    }
  })()
})
rl.on('close', () => { process.exit(0) })

process.stderr.write('[jarvis-bridge] 已启动 → ' + BASE + '（令牌:' + (readToken() ? '已就绪' : '缺失,先启动 Jarvis') + '）\n')
