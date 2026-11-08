import type { JarvisEvent } from './types.js'
import { enqueueBackgroundMessage } from '../jarvis/orchestrator.js'
import { pushProactiveMessage } from '../jarvis/proactive.js'
import { generateMorningReport } from './reports.js'
import { createEventWriter } from './writer.js'
import { triageMessage } from './triage.js'
import { jdsmeSink, initJdMeSource, getJdMeOwnerErp } from './sources/jdsme.js'
import { createCronSource } from './sources/cron.js'
import { broadcast } from '../jarvis/sse.js'
import { deliverToTask, ensureThread, formatGroupMessage, groupThreadKey, listSubscribers, recordTrigger, threadWindow } from '../a2a/threads.js'
import { addStage, bumpCounter, setOutcome, startTrace } from '../jarvis/message-trace.js'
import { createXingyunSource, handleXingyunEvent } from './sources/xingyun.js'
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
          addStage(payload.msgId, 'Trigger 幂等:重复丢弃', { mech: 'dedup' })
          setOutcome(payload.msgId, 'dropped-dup')
          console.log(`[events] 重复消息丢弃: ${payload.msgId}`)
          return
        }
        addStage(payload.msgId, 'Trigger 登记 ✓', { detail: `线程 ${threadKey}`, mech: 'trigger-登记' })
        await ensureThread(ev.userId, threadKey, payload.chatName)
        const subscribers = await listSubscribers(ev.userId, threadKey)
        if (subscribers.length > 0) {
          const isOwner = !!getJdMeOwnerErp() && payload.sender === getJdMeOwnerErp()
          const senderLabel = isOwner ? 'Sir(唯一主人)' : payload.sender
          const shown = formatGroupMessage(payload, senderLabel)
          addStage(payload.msgId, `订阅命中 ${subscribers.length} 个任务`, { mech: '订阅直通' })
          let deliveredTo = ''
          for (const taskId of subscribers) {
            const r = await deliverToTask(ev.userId, taskId, payload, {
              senderLabel,
              broadcastOnce: (text) => broadcast('user_message', JSON.stringify({ text }), ev.userId, 'event-reply'),
            })
            if (r.delivered) deliveredTo += (deliveredTo ? ',' : '') + r.note
          }
          if (deliveredTo) {
            addStage(payload.msgId, `直通 ${deliveredTo}`, { detail: shown.slice(0, 160), mech: '订阅直通' })
            bumpCounter('direct-through')
            setOutcome(payload.msgId, 'direct-through', { detail: deliveredTo })
            console.log(`[events] 群消息直通(${payload.msgId} → ${deliveredTo}),不进 brain`)
            return  // 订阅直通语义:人的消息直达小弟,不经 Eval/brain(dsh §3.2)
          }
          // 全部投递失败(无在跑小弟/不在线)→ 回落下方 Router 路径
          addStage(payload.msgId, '订阅在但无在跑小弟,回落 Router')
          console.log('[events] 订阅存在但无在跑小弟,回落 Router')
        }
        const triage = await triageMessage(ev.userId, payload.text)
        if (triage.category === 'noise') {
          addStage(payload.msgId, '分诊:噪音丢弃', { detail: triage.summary || payload.text.slice(0, 60), mech: 'LLM分诊' })
          bumpCounter('noise-dropped')
          setOutcome(payload.msgId, 'dropped-noise', { detail: triage.summary })
          console.log(`[events] 噪音丢弃: ${payload.chatId} "${payload.text.slice(0, 40)}"`)
          return
        }
        addStage(payload.msgId, '分诊放行', { detail: '分诊判定为实质消息', mech: 'LLM分诊' })
      }
      // 走 Jarvis 完整 think():它按岗位纪律直接回话或 create_task;
      // 拿不准会反问——反问文本经 EventWriter 回到京ME,同时 web 聊天可见
      // P3:群聊候选注入评估窗口(线程最近消息)+ 评估纪律 —— 上下文有界,决策有据
      let evalWindow = ''
      let evalDiscipline = ''
      if (payload.kind === 'group') {
        const window = await threadWindow(ev.userId, groupThreadKey(payload.chatId))
        if (window) {
          evalWindow = `\n\n【该群最近消息(评估窗口)】\n${window}`
        }
        evalDiscipline = `\n\n【评估纪律(P3,先于一切动作)】\n` +
          `接单前确立三个独立事实:①讨论针对本系统/本团队的真实工作;②消息方明确表达了一件具体的事要办;③方向足够确定,无需替人做产品决策。` +
          `三者不齐 → 只反问澄清,**绝不 create_task**;纯寒暄/设计讨论/假设性偏好 → 礼貌略过,不追问不建任务。` +
          `群里的连续消息是自然澄清过程——等意图确立那一条再动手。`
      }
      const writer = createEventWriter(ev.userId, ev, sinks)
      // 身份标注(权限纪律用):京ME 消息的 sender 与配置的 ownerErp 比对,
      // 结果作为可信标注写进消息前缀 —— 模型不靠自称判身份。
      const isOwner = !!getJdMeOwnerErp() && payload.sender === getJdMeOwnerErp()
      const who = isOwner ? 'Sir(唯一主人)' : `其他人(${payload.sender},非主人)`
      const labeled = `【京ME ${payload.kind === 'group' ? '群' : '私聊'}「${payload.chatName}」· ${who}】\n${payload.text}\n\n(此消息来自京ME${payload.kind === 'group' ? '群聊' : '私聊'},发消息的是${who}。回复会送回该聊天,请按京ME 信道习惯说话——短平快,两三句说完,不用 markdown,先结论后细节。按「权限与拒绝纪律」判定此人可以要求什么。)${evalWindow}${evalDiscipline}`
      // 登记对话来源:本次 think 期间 Jarvis create_task 时会把它挂到任务上,
      // 任务完成后的复盘汇报会同步回这个群/私聊。来源随消息入队、开跑时生效、
      // 收尾时清空 —— 排队期间不会串台。
      enqueueBackgroundMessage(ev.userId, labeled, writer, {
        kind: payload.kind, chatId: payload.chatId, chatName: payload.chatName,
        sender: payload.sender, isOwner,
      }, payload.msgId)
      break
    }

    case 'xingyun_card':
    case 'xingyun_card_closed': {
      // 行云需求卡(P5 车道A):卡片即 Mandate —— auto 直派 / approval 进队列 / closed 收尾
      await handleXingyunEvent(ev)
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
  try {
    defs.push(createXingyunSource())
  } catch (err) {
    console.error('[events] 行云端初始化失败:', err instanceof Error ? err.message : err)
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
