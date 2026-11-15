import { Router } from 'express'
import { listUsers } from '../../auth/users.js'
import { enqueueBackgroundMessage, noopWriter, type SSEWriter } from '../orchestrator.js'
import { verifyBridgeToken } from '../../mcp/bridge-token.js'
import { createPendingReply, completeReply, getReply } from '../../mcp/reply-inbox.js'
import { addStage, bumpCounter, startTrace } from '../message-trace.js'

/**
 * MCP 桥接的内部 API(给 desktop/agent/mcp/jarvis-server.mjs 用)。
 *
 * 外部 agent(Claude Code / Codex)说不了 A2A,但它们都支持 MCP;
 * 本机 stdio MCP server 把工具调用转成这里的 HTTP 请求:
 *   POST /api/mcp/message { text, from?, wait?, timeoutSeconds? }
 *
 * 鉴权:外部 agent 没有浏览器登录态,用本机令牌(~/.jarvis/mcp-token,
 * 与 MCP server 共用一份;env JARVIS_MCP_TOKEN 可覆盖)。
 *
 * 身份:消息归属真实主人(第一个注册用户),不是 'system' —— 否则外部 agent
 * 触发的任务/记忆会落到 system 名下,和 Sir 的数据割裂。
 *
 * 语义:
 *   wait=false(默认) → 入后台队列立即返回,回复出现在 Jarvis 聊天流
 *   wait=true        → 等本次 think 产出的最终回复并回传(MCP 的 ask 用)
 */

/** 给 Jarvis 的消息标签(含来源与授权边界提醒)。纯函数,便于单测。 */
export function buildMcpMessageLabel(from: string, text: string): string {
  return `【外部 Agent「${from}」→ Jarvis】\n${text}\n\n(这是本机外部 agent 通过 MCP 桥接发来的消息,发件工具:${from}。它是 Sir 本机的工具,按 Sir 的授权边界处理:可以回答、查询;涉及改配置、对外发送、转正等动作仍按权限纪律,必要时先向 Sir 确认。回复会通过 MCP 返回给该工具。)`
}

/** 捕获后台 think 的最终回复:response 事件 settle 一次。 */
function createCaptureWriter(id: string): { writer: SSEWriter; done: Promise<string> } {
  let settle: (text: string) => void = () => {}
  let finalText = ''
  const done = new Promise<string>(resolve => { settle = resolve })
  const writer: SSEWriter = {
    id,
    closed: false,
    send(type: string, content: string) {
      if (type === 'response') {
        finalText = content
        settle(content)
      }
    },
    end() {
      this.closed = true
      settle(finalText || '(无回复)')
    },
  }
  return { writer, done }
}

export function mcpBridgeRoutes(): Router {
  const r = Router()

  r.get('/api/mcp/health', (req, res) => {
    if (!verifyBridgeToken(req.headers['x-jarvis-mcp-token'])) {
      res.status(401).json({ ok: false, error: 'MCP 桥接令牌无效' })
      return
    }
    res.json({ ok: true, service: 'jarvis-mcp-bridge' })
  })

  r.post('/api/mcp/message', async (req, res) => {
    if (!verifyBridgeToken(req.headers['x-jarvis-mcp-token'])) {
      res.status(401).json({ ok: false, error: 'MCP 桥接令牌无效(检查 ~/.jarvis/mcp-token)' })
      return
    }
    const text = String(req.body?.text ?? '').trim().slice(0, 4000)
    if (!text) {
      res.status(400).json({ ok: false, error: 'text 不能为空' })
      return
    }
    const from = String(req.body?.from ?? '外部 Agent').trim().slice(0, 40) || '外部 Agent'
    const wait = req.body?.wait === true
    const timeoutSeconds = Math.min(300, Math.max(10, Number(req.body?.timeoutSeconds) || 120))

    const users = await listUsers().catch(() => [])
    const ownerId = users[0]?.id
    if (!ownerId) {
      res.status(503).json({ ok: false, error: '还没有注册用户,Jarvis 不知道该以谁的身份处理' })
      return
    }

    const labeled = buildMcpMessageLabel(from, text)
    const msgId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 运行面板流水:外部 agent 的消息同链留痕(channel=mcp)
    startTrace(ownerId, msgId, { channel: 'mcp', sender: from, textPreview: text })
    addStage(msgId, `收到 · MCP 桥接(外部 agent「${from}」)`, { mech: 'mcp-bridge' })
    bumpCounter('mcp-in')

    if (!wait) {
      // 异步:立即返回 msgId;后台 think 完成后把最终回复写进收件箱,
      // 调用方稍后用 check_jarvis_reply(msgId) 取回(也能在聊天流看到)。
      const { writer, done } = createCaptureWriter(`mcp-${msgId}`)
      await createPendingReply(ownerId, msgId, text, from).catch(() => {})
      enqueueBackgroundMessage(ownerId, labeled, writer, undefined, msgId)
      void done.then(reply => completeReply(ownerId, msgId, reply || '(无回复)')).catch(() => {})
      res.json({ ok: true, delivered: true, msgId, note: '已入 Jarvis 处理队列;完成后用 check_jarvis_reply 取回复,或等它出现在聊天流' })
      return
    }

    const { writer, done } = createCaptureWriter(`mcp-${msgId}`)
    enqueueBackgroundMessage(ownerId, labeled, writer, undefined, msgId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const reply = await Promise.race([
      done,
      new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), timeoutSeconds * 1000) }),
    ])
    if (timer) clearTimeout(timer)
    if (!reply) {
      res.json({ ok: true, pending: true, msgId, reply: '仍在处理,结果稍后会出现在 Jarvis 聊天里。' })
      return
    }
    res.json({ ok: true, reply, msgId })
  })

  // 异步消息的回复查询(轮询用):done 返回 reply;pending 表示还在处理;expired 表示等不到了
  r.get('/api/mcp/reply/:id', async (req, res) => {
    if (!verifyBridgeToken(req.headers['x-jarvis-mcp-token'])) {
      res.status(401).json({ ok: false, error: 'MCP 桥接令牌无效' })
      return
    }
    const users = await listUsers().catch(() => [])
    const ownerId = users[0]?.id
    if (!ownerId) { res.status(503).json({ ok: false, error: '还没有注册用户' }); return }
    const record = await getReply(ownerId, req.params.id)
    if (!record) { res.status(404).json({ ok: false, status: 'unknown', error: '没有这个 msgId' }); return }
    res.json({ ok: true, status: record.status, reply: record.reply, createdAt: record.createdAt, doneAt: record.doneAt })
  })

  return r
}
