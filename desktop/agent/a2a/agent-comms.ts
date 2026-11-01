import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { bus } from './bus.js'
import { getPeerAgents } from './registry.js'
import { broadcast } from '../jarvis/sse.js'

/**
 * 小弟之间的沟通工具集(Jarvis 之外,A2A agent 互相 + 向 Jarvis 汇报)。
 *
 * 迁移自 Claude Agent SDK 的 createSdkMcpServer + tool()。
 * Pi 不用 MCP,工具通过 defineTool() 定义成 ToolDefinition 数组,
 * 由调用方(a2a/client.ts)经 createAgentSession({ customTools }) 挂载。
 *
 * 工具清单(与旧版逐一对齐):
 *   - message_jarvis : 向 Jarvis 捎话(progress/question/deliverable/blocked)
 *   - message_peer   : 给并行协作的其他小弟发消息(异步,发完不等)
 *   - check_inbox    : 查收件箱(Jarvis 追加指令 / peer 消息或回复)
 *   - list_peers     : 列出当前任务的并行协作 agent
 */
export function createAgentCommsTools(subtaskId: string, taskId: string, userId: string, agentName: string): ToolDefinition[] {
  const typeLabel: Record<string, string> = {
    progress: '进展',
    question: '请示',
    deliverable: '交付',
    blocked: '受阻',
  }

  return [
    defineTool({
      name: 'message_jarvis',
      label: 'Message Jarvis',
      description: '给管家 Jarvis 捎句话。汇报进展、拿不准想问一句、交个中间成果、卡住了求助——都走这个。' +
        '像跟同事说话那样直接开口,别写成公文。Jarvis 会回你,你按回复接着干。',
      parameters: Type.Object({
        content: Type.String({ description: '要说的话,口语直给,别端着' }),
        type: Type.Union(
          [Type.Literal('progress'), Type.Literal('question'), Type.Literal('deliverable'), Type.Literal('blocked')],
          { description: '消息类型：progress=报个进展, question=问一句, deliverable=交个中间成果, blocked=卡住了求助' },
        ),
      }),
      execute: async (_toolCallId, params) => {
        // 把小弟主动发的消息推到前端，让用户看到中途的回执/进展/请示/交付
        const label = typeLabel[params.type] || params.type
        broadcast('progress', `💬 ${agentName}[${label}]：${params.content.slice(0, 120)}`, userId)

        const reply = await bus.send(userId, subtaskId, 'jarvis', taskId, `[${params.type}] ${params.content}`, { type: params.type })
        const replyText = reply?.parts.find(p => p.kind === 'text')?.text || '（Jarvis 暂无回复，继续执行）'
        return { content: [{ type: 'text', text: replyText }], details: {} }
      },
    }),

    defineTool({
      name: 'message_peer',
      label: 'Message Peer',
      description: '跟一起干这个任务的其他小弟搭句话(异步,发完不用等,继续干你的)。' +
        '共享个中途发现、找对方要点数据、对一下分工、或者单纯招呼一声——都行。' +
        '你俩是并肩干活的搭子,说话随意点、像真人,别打官腔。' +
        '对方回你了,下一轮 check_inbox 就能看到。先用 list_peers 看有哪些兄弟在线。',
      parameters: Type.Object({
        peerId: Type.String({ description: '目标小弟的 subtaskId(从 list_peers 获取)' }),
        content: Type.String({ description: '要说的话,口语直给' }),
      }),
      execute: async (_toolCallId, params) => {
        if (!bus.isRegistered(params.peerId)) {
          return { content: [{ type: 'text', text: `Agent ${params.peerId} 不在线或已完成,消息未送达。` }], details: {} }
        }
        await bus.notify(userId, subtaskId, params.peerId, taskId, params.content)
        return {
          content: [{ type: 'text', text: `已投递给 ${params.peerId}。对方回复后进你的收件箱,用 check_inbox 查看。你可以继续干别的。` }],
          details: {},
        }
      },
    }),

    defineTool({
      name: 'check_inbox',
      label: 'Check Inbox',
      description: '查看你的收件箱:Jarvis 的追加指令、其他 Agent 的消息或回复都在这里。' +
        '每次 check 会清空已读,所以看到内容记得回应或记下。适合每几轮工作后主动查一次。',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params) => {
        const msgs = bus.drainInbox(subtaskId)
        if (msgs.length === 0) {
          return { content: [{ type: 'text', text: '收件箱空。' }], details: {} }
        }
        const formatted = msgs.map((m, i) => {
          const text = m.parts.find(p => p.kind === 'text')?.text || ''
          const from = m.from === 'jarvis' ? 'Jarvis' : `Agent ${m.from}`
          return `${i + 1}. 来自 ${from}(${m.timestamp.slice(11, 19)}): ${text}`
        }).join('\n')
        return {
          content: [{ type: 'text', text: `收件箱有 ${msgs.length} 条新消息:\n${formatted}\n\n如需回复某位兄弟,用 message_peer(peerId=对方 subtaskId, content=...)。` }],
          details: {},
        }
      },
    }),

    defineTool({
      name: 'list_peers',
      label: 'List Peers',
      description: '查看当前和你并行协作的其他 Agent 列表（同一任务下的兄弟 agent）',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params) => {
        const peers = await getPeerAgents(userId, taskId, subtaskId)
        if (peers.length === 0) {
          return { content: [{ type: 'text', text: '当前没有并行协作的其他 Agent。你是独立执行的。' }], details: {} }
        }
        const list = peers.map(p => `- ${p.name} (id: ${p.subtaskId}): 正在做「${p.task}」`).join('\n')
        return {
          content: [{ type: 'text', text: `当前协作 Agent：\n${list}\n\n用 message_peer 发消息时，peerId 填上面的 id。` }],
          details: {},
        }
      },
    }),
  ]
}
