import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { bus } from './bus.js'
import { getPeerAgents } from './registry.js'
import { broadcast } from '../jarvis/sse.js'

export function createAgentCommsMcp(subtaskId: string, taskId: string, userId: string, agentName: string) {
  const typeLabel: Record<string, string> = {
    progress: '进展',
    question: '请示',
    deliverable: '交付',
    blocked: '受阻',
  }
  return createSdkMcpServer({
    name: 'agent-comms',
    alwaysLoad: true,
    tools: [
      tool(
        'message_jarvis',
        '给管家 Jarvis 发消息。用于：汇报阶段性进展、请示决策、交付中间结果、遇到阻塞时求助。' +
          'Jarvis 会回复你，你可以根据回复继续执行。',
        {
          content: z.string().describe('要发送的消息内容'),
          type: z.enum(['progress', 'question', 'deliverable', 'blocked']).describe('消息类型：progress=进展汇报, question=请示, deliverable=阶段交付, blocked=阻塞求助'),
        },
        async (args) => {
          // 把小弟主动发的消息推到前端，让用户看到中途的回执/进展/请示/交付
          const label = typeLabel[args.type] || args.type
          broadcast('progress', `💬 ${agentName}[${label}]：${args.content.slice(0, 120)}`, userId)

          const reply = await bus.send(subtaskId, 'jarvis', taskId, `[${args.type}] ${args.content}`, { type: args.type })
          const replyText = reply?.parts.find(p => p.kind === 'text')?.text || '（Jarvis 暂无回复，继续执行）'
          return { content: [{ type: 'text' as const, text: replyText }] }
        }
      ),

      tool(
        'message_peer',
        '给同一任务组里并行的其他 Agent 发消息(异步、非阻塞)。' +
          '消息直接投递到对方收件箱,你立刻拿到"已送达"回执并继续干活,' +
          '对方回复后放进你的收件箱,你自己用 check_inbox 去看。' +
          '适用:共享中途发现、请求对方数据、协调分工;不阻塞你当前的推理。' +
          '先用 list_peers 查有哪些兄弟在线。',
        {
          peerId: z.string().describe('目标 Agent 的 subtaskId(从 list_peers 获取)'),
          content: z.string().describe('要发送的消息内容'),
        },
        async (args) => {
          if (!bus.isRegistered(args.peerId)) {
            return { content: [{ type: 'text' as const, text: `Agent ${args.peerId} 不在线或已完成,消息未送达。` }] }
          }
          await bus.notify(subtaskId, args.peerId, taskId, args.content)
          return { content: [{ type: 'text' as const, text: `已投递给 ${args.peerId}。对方回复后进你的收件箱,用 check_inbox 查看。你可以继续干别的。` }] }
        }
      ),

      tool(
        'check_inbox',
        '查看你的收件箱:Jarvis 的追加指令、其他 Agent 的消息或回复都在这里。' +
          '每次 check 会清空已读,所以看到内容记得回应或记下。适合每几轮工作后主动查一次。',
        {},
        async () => {
          const msgs = bus.drainInbox(subtaskId)
          if (msgs.length === 0) {
            return { content: [{ type: 'text' as const, text: '收件箱空。' }] }
          }
          const formatted = msgs.map((m, i) => {
            const text = m.parts.find(p => p.kind === 'text')?.text || ''
            const from = m.from === 'jarvis' ? 'Jarvis' : `Agent ${m.from}`
            return `${i + 1}. 来自 ${from}(${m.timestamp.slice(11, 19)}): ${text}`
          }).join('\n')
          return { content: [{ type: 'text' as const, text: `收件箱有 ${msgs.length} 条新消息:\n${formatted}\n\n如需回复某位兄弟,用 message_peer(peerId=对方 subtaskId, content=...)。` }] }
        }
      ),

      tool(
        'list_peers',
        '查看当前和你并行协作的其他 Agent 列表（同一任务下的兄弟 agent）',
        {},
        async () => {
          const peers = await getPeerAgents(userId, taskId, subtaskId)
          if (peers.length === 0) {
            return { content: [{ type: 'text' as const, text: '当前没有并行协作的其他 Agent。你是独立执行的。' }] }
          }
          const list = peers.map(p => `- ${p.name} (id: ${p.subtaskId}): 正在做「${p.task}」`).join('\n')
          return { content: [{ type: 'text' as const, text: `当前协作 Agent：\n${list}\n\n用 message_peer 发消息时，peerId 填上面的 id。` }] }
        }
      ),
    ],
  })
}
