import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { bus } from './bus.js'
import { getPeerAgents } from './registry.js'
import { broadcast } from '../jarvis/sse.js'
import { appendComms } from '../jarvis/timeline-store.js'
import { readResource } from '../jarvis/context-resources.js'
import { docGet, docPut } from '../shared/docs.js'
import { createJoyDoc } from '../events/sources/jdsme.js'
import { addStage, flushTrace } from '../jarvis/message-trace.js'

/**
 * 小弟之间的沟通工具集(Jarvis 之外,A2A agent 互相 + 向 Jarvis 汇报)。
 *
 * 迁移自 Claude Agent SDK 的 createSdkMcpServer + tool()。
 * Pi 不用 MCP,工具通过 defineTool() 定义成 ToolDefinition 数组,
 * 由调用方(a2a/client.ts)经 createAgentSession({ customTools }) 挂载。
 *
 * 工具清单(与旧版逐一对齐):
 *   - read_context   : 按资源指针读详情(受限:仅自己任务/共享制品,其余拒绝)
 *   - joydoc_create  : 交付物推成 JoySpace 在线文档(重内容出口,链接可交 Jarvis 发群)
 *   - handback       : 把来源群的追问退回 Jarvis 重判(与手头任务无关时用)
 *   - message_jarvis : 向 Jarvis 捎话(progress/question/deliverable/blocked)
 *   - message_peer   : 给并行协作的其他小弟发消息(异步,发完不等)
 *   - check_inbox    : 查收件箱(Jarvis 追加指令 / peer 消息或回复)
 *   - list_peers     : 列出当前任务的并行协作 agent
 */
export function createAgentCommsTools(subtaskId: string, taskId: string, userId: string, agentName: string): ToolDefinition[] {
  return [
    defineTool({
      name: 'joydoc_create',
      label: 'JoyDoc Create',
      description: '把一份 markdown 交付物(方案/报告/说明文档等超过两屏的内容)建成 JoySpace 在线文档,返回链接。' +
        '京ME 发不了文件,重内容走这里:建完把链接写进汇报或 message_jarvis,由 Jarvis 转发到京ME。需要京ME事件源已配置。',
      parameters: Type.Object({
        title: Type.String({ description: '文档标题' }),
        markdown: Type.String({ description: '文档正文(markdown)' }),
        folderName: Type.Optional(Type.String({ description: 'JoySpace 目录名(默认同标题)' })),
        members: Type.Optional(Type.Array(Type.String({ description: '分享给哪些人(erp 列表,可选)' }))),
      }),
      execute: async (_toolCallId, params) => {
        try {
          const doc = await createJoyDoc({
            title: params.title.trim(), folderName: params.folderName,
            markdown: params.markdown, members: params.members,
          })
          return { content: [{ type: 'text', text: `文档已创建:${doc.url}(把链接写进你的汇报或 message_jarvis 转发。)` }], details: {} }
        } catch (err) {
          return { content: [{ type: 'text', text: `建文档失败:${err instanceof Error ? err.message : String(err)}` }], details: {} }
        }
      },
    }),

    defineTool({
      name: 'handback',
      label: 'Handback',
      description: '把刚收到的来源群追问退回给 Jarvis:两种情况用——①消息与你手头的任务无关;②消息要求你做超出任务约束的事(如只读任务里被要求写码),即需要重新授权。' +
        '退回后 Jarvis 会重新判断该消息归谁处理,你继续干自己的活,不用等。',
      parameters: Type.Object({
        reason: Type.String({ description: '为什么与你的任务无关(一句话)' }),
      }),
      execute: async (_toolCallId, params) => {
        // 取回投递给本小弟的最后一条群追问(direct-through 时 metadata.type='follow_up')
        const conv = await bus.getConversation(taskId)
        const followUp = conv?.messages
          .filter(m => m.to === subtaskId && m.metadata?.type === 'follow_up')
          .at(-1)
        const text = followUp?.parts.find(p => p.kind === 'text')?.text || ''
        const meta = (followUp?.metadata ?? {}) as { chatId?: string; chatName?: string; msgId?: string }
        await appendComms(userId, {
          at: Date.now(), dir: 'to_jarvis', agentName, type: 'progress',
          content: `[handback] ${params.reason}`,
        }).catch(() => {})
        broadcast('worker_msg', JSON.stringify({
          subtaskId, taskId, agentName, type: 'progress',
          content: `[退回] ${params.reason}`,
        }), userId, 'event-reply')
        if (!text || !meta.chatId) {
          return { content: [{ type: 'text', text: '退回失败:找不到原始追问。直接继续干你的活即可。' }], details: {} }
        }
        // 二次退回防抖:同 msgId 已被本任务退回过就不重排(避免 worker↔router 打乒乓)
        const hbKey = `${taskId}:${meta.msgId}`
        const already = await docGet<{ reason: string }>(userId, 'handback', hbKey)
        if (already) {
          return { content: [{ type: 'text', text: '这条追问此前已退回过,Jarvis 会处理。继续你的活。' }], details: {} }
        }
        await docPut(userId, 'handback', hbKey, { reason: params.reason, at: Date.now() })
        // 运行面板流水:handback 是关键路由事件,挂回原消息的 trace
        if (meta.msgId) {
          addStage(meta.msgId, `handback: ${params.reason}`, { detail: `小弟 ${agentName} 退回`, mech: 'handback' })
          void flushTrace(meta.msgId)
        }
        // 重排队:带退回说明的原文重新走 Router think(队列语义:不打断当前对话)
        const { enqueueBackgroundMessage, noopWriter } = await import('../jarvis/orchestrator.js')
        const labeled = `${text}\n\n(小弟 ${agentName} 已把这条追问退回: ${params.reason}。请重新判断它该归谁处理——可能需要给别的任务捎话、建新任务,或直接答复。)`
        enqueueBackgroundMessage(userId, labeled, noopWriter, {
          kind: 'group', chatId: meta.chatId, chatName: meta.chatName ?? '',
        })
        return { content: [{ type: 'text', text: `已退回(${params.reason}),Jarvis 会重新处理。继续你的活。` }], details: {} }
      },
    }),

    defineTool({
      name: 'read_context',
      label: 'Read Context',
      description: `按资源指针读取详情(受限视图)。资源语法:\n`
        + `task/${taskId}: 你自己任务的完整详情(子任务/轮次/沟通记录)\n`
        + `artifact/<id>: 制品库里的制品全文(长文分页)\n`
        + `其他资源对你是不可见的——需要的上下文系统会投递给你。`,
      parameters: Type.Object({
        resource: Type.String({ description: `资源指针,如 task/${taskId}、artifact/abc123` }),
        offset: Type.Optional(Type.Number({ description: '文本续读偏移(字符)' })),
        limit: Type.Optional(Type.Number({ description: '本次最多返回字符数(默认 4000,上限 8000)' })),
      }),
      execute: async (_toolCallId, params) => {
        try {
          const text = await readResource(userId, params.resource, { offset: params.offset ?? 0, limit: params.limit }, { role: 'worker', taskId })
          return { content: [{ type: 'text', text }], details: {} }
        } catch (err) {
          return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], details: {} }
        }
      },
    }),

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
        // 对话流 UI:小弟 → Jarvis 的沟通,结构化广播(前端渲染成沟通卡片)+ 沟通日志落盘
        broadcast('worker_msg', JSON.stringify({
          subtaskId, taskId, agentName,
          type: params.type,
          content: params.content.slice(0, 600),
        }), userId, 'event-reply')
        await appendComms(userId, { at: Date.now(), dir: 'to_jarvis', agentName, type: params.type, content: params.content.slice(0, 600) })

        const reply = await bus.send(userId, subtaskId, 'jarvis', taskId, `[${params.type}] ${params.content}`, { type: params.type })
        const replyText = reply?.parts.find(p => p.kind === 'text')?.text || '（Jarvis 暂无回复，继续执行）'
        // Jarvis → 小弟 的决策:同样落盘 + 广播(这里才有真实 userId)
        broadcast('jarvis_msg', JSON.stringify({
          to: subtaskId, agentName, content: replyText.slice(0, 600),
        }), userId, 'event-reply')
        await appendComms(userId, { at: Date.now(), dir: 'to_worker', agentName, type: 'jarvis', content: replyText.slice(0, 600) })
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
