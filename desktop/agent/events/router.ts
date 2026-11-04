import type { JarvisEvent } from './types.js'
import { enqueueBackgroundMessage } from '../jarvis/orchestrator.js'
import { pushProactiveMessage } from '../jarvis/proactive.js'
import { generateMorningReport } from './reports.js'
import { createEventWriter } from './writer.js'
import { triageMessage } from './triage.js'
import { jdsmeSink, initJdMeSource } from './sources/jdsme.js'
import { createCronSource } from './sources/cron.js'
import type { EventSink, EventSourceDef } from './types.js'

/**
 * 事件路由(docs/superagent-design.md §3):
 *   cron/morning_report → 程序组装 → 主动消息
 *   jdsme/im_message    → slowPath 噪音分诊 → Jarvis 完整 think()(经后台队列,不打断对话)
 *                         → EventWriter 把最终回复送回京ME sink
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
        const triage = await triageMessage(ev.userId, payload.text)
        if (triage.category === 'noise') {
          console.log(`[events] 噪音丢弃: ${payload.chatId} "${payload.text.slice(0, 40)}"`)
          return
        }
      }
      // 走 Jarvis 完整 think():它按岗位纪律直接回话或 create_task;
      // 拿不准会反问——反问文本经 EventWriter 回到京ME,同时 web 聊天可见
      const writer = createEventWriter(ev.userId, ev, sinks)
      const labeled = `【京ME ${payload.kind === 'group' ? '群' : '私聊'}「${payload.chatName}」· ${payload.sender}】\n${payload.text}`
      enqueueBackgroundMessage(ev.userId, labeled, writer)
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
