import type { JarvisEvent } from './types.js'
import { enqueueBackgroundMessage } from '../jarvis/orchestrator.js'
import { pushProactiveMessage } from '../jarvis/proactive.js'
import { generateMorningReport } from './reports.js'
import { createEventWriter } from './writer.js'
import { triageMessage } from './triage.js'
import { jdsmeSink, initJdMeSource, getJdMeOwnerErp } from './sources/jdsme.js'
import { createCronSource } from './sources/cron.js'
import { broadcast } from '../jarvis/sse.js'
import { deliverToTask, ensureThread, formatGroupMessage, groupThreadKey, listSubscribers, recordTrigger } from '../a2a/threads.js'
import type { EventSink, EventSourceDef } from './types.js'

/**
 * 事件路由(docs/superagent-design.md §3 + superagent-v2.md P2):
 *   cron/morning_report → 程序组装 → 主动消息
 *   jdsme/im_message    → P2 intake 分流:
 *                          群消息先过 Trigger 幂等 → 有订阅任务且直通成功 → 结束(不进 brain)
 *                          否则 → slowPath 噪音分诊 → Jarvis 完整 think()(经后台队列)
 *                          → EventWriter 把最终回复送回京ME sink
 */

const sinks: EventSink[] = [jdsmeSink]
const sources: EventSourceDef[] = []

async function handleEvent(ev: JarvisEvent): Promise<void> {
  switch (ev.type) {
    case 'morning_report': {
      const text = await generateMorningReport(ev.userId)
      // 用户自己定的日程,force 推送(默认 9:00 也不在免打扰时段)
      await pushProactiveMessage(ev.userId, text, { force: true })
      break
    }

    case 'im_message': {
      const payload = ev.payload as { kind: 'group' | 'dm'; chatId: string; chatName: string; sender: string; text: string; msgId: string }
      // 私聊 = Sir 的直接对话,不分诊、不丢弃,全部进 Jarvis;
      // 噪音分诊只用于群聊(@机器人 的寒暄贴才可能成为噪音)——"你好"被丢的教训。
      if (payload.kind === 'group') {
        // ── P2 intake:Trigger 幂等 → 订阅直通 → 无订阅才走分诊/brain ──
        const threadKey = groupThreadKey(payload.chatId)
        const fresh = await recordTrigger(ev.userId, threadKey, payload)
        if (!fresh) {
          console.log(`[events] 重复消息丢弃: ${payload.msgId}`)
          return
        }
        await ensureThread(ev.userId, threadKey, payload.chatName)
        const subscribers = await listSubscribers(ev.userId, threadKey)
        if (subscribers.length > 0) {
          const isOwner = !!getJdMeOwnerErp() && payload.sender === getJdMeOwnerErp()
          const senderLabel = isOwner ? 'Sir(唯一主人)' : payload.sender
          const shown = formatGroupMessage(payload, senderLabel)
          let deliveredTo = ''
          for (const taskId of subscribers) {
            const r = await deliverToTask(ev.userId, taskId, payload, {
              senderLabel,
              broadcastOnce: (text) => broadcast('user_message', JSON.stringify({ text }), ev.userId, 'event-reply'),
            })
            if (r.delivered) deliveredTo += (deliveredTo ? ',' : '') + r.note
          }
          if (deliveredTo) {
            console.log(`[events] 群消息直通(${payload.msgId} → ${deliveredTo}),不进 brain`)
            return  // 订阅直通语义:人的消息直达小弟,不经 Eval/brain(dsh §3.2)
          }
          // 全部投递失败(无在跑小弟/不在线)→ 回落下方 Router 路径
          console.log('[events] 订阅存在但无在跑小弟,回落 Router')
        }
        const triage = await triageMessage(ev.userId, payload.text)
        if (triage.category === 'noise') {
          console.log(`[events] 噪音丢弃: ${payload.chatId} "${payload.text.slice(0, 40)}"`)
          return
        }
      }
      // 走 Jarvis 完整 think():它按岗位纪律直接回话或 create_task;
      // 拿不准会反问——反问文本经 EventWriter 回到京ME,同时 web 聊天可见
      const writer = createEventWriter(ev.userId, ev, sinks)
      // 身份标注(权限纪律用):京ME 消息的 sender 与配置的 ownerErp 比对,
      // 结果作为可信标注写进消息前缀 —— 模型不靠自称判身份。
      const isOwner = !!getJdMeOwnerErp() && payload.sender === getJdMeOwnerErp()
      const who = isOwner ? 'Sir(唯一主人)' : `其他人(${payload.sender},非主人)`
      const labeled = `【京ME ${payload.kind === 'group' ? '群' : '私聊'}「${payload.chatName}」· ${who}】\n${payload.text}\n\n(此消息来自京ME${payload.kind === 'group' ? '群聊' : '私聊'},发消息的是${who}。回复会送回该聊天,请按京ME 信道习惯说话——短平快,两三句说完,不用 markdown,先结论后细节。按「权限与拒绝纪律」判定此人可以要求什么。)`
      // 登记对话来源:本次 think 期间 Jarvis create_task 时会把它挂到任务上,
      // 任务完成后的复盘汇报会同步回这个群/私聊。来源随消息入队、开跑时生效、
      // 收尾时清空 —— 排队期间不会串台。
      enqueueBackgroundMessage(ev.userId, labeled, writer, {
        kind: payload.kind, chatId: payload.chatId, chatName: payload.chatName,
        sender: payload.sender, isOwner,
      })
      break
    }

    default:
      console.log(`[events] 未处理事件类型: ${ev.type}(${ev.source})`)
  }
}

export async function startEventSystem(): Promise<void> {
  const defs: Array<EventSourceDef | null> = [createCronSource()]
  try {
    defs.push(await initJdMeSource())
  } catch (err) {
    console.error('[events] 京ME源初始化失败:', err instanceof Error ? err.message : err)
  }

  const ctx = {
    emit: (ev: JarvisEvent) => {
      handleEvent(ev).catch(err =>
        console.error('[events] 事件处理失败:', err instanceof Error ? err.message : err))
    },
  }
  for (const s of defs) {
    if (!s) continue
    sources.push(s)
    try {
      s.start(ctx)
    } catch (err) {
      console.error(`[events] 源 ${s.id} 启动失败:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`[events] 事件系统已启动(${sources.length} 个源: ${sources.map(s => s.id).join(', ')})`)
}

export function stopEventSystem(): void {
  for (const s of sources) s.stop()
  sources.length = 0
}
