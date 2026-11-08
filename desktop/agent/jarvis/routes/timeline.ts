import { Router } from 'express'
import { getAllTimelines, getTimeline, getComms } from '../timeline-store.js'
import { docGet, docList } from '../../shared/docs.js'
import { getQueueStatus } from '../orchestrator.js'
import { getCounters } from '../message-trace.js'
import { getJdMeRuntimeInfo } from '../../events/sources/jdsme.js'
import { getXingyunRuntimeInfo } from '../../events/sources/xingyun.js'

/**
 * 对话流时间线/沟通日志读取(刷新还原用)。
 * 写入侧:brain.ts think() 落盘时间线;agent-comms / send_message 追加沟通日志。
 */
export function timelineRoutes(): Router {
  const r = Router()

  // 该用户全部消息时间线(刷新后一次性拉取,前端按 message_id 对齐)
  r.get('/api/timeline/all', async (req, res) => {
    res.json({ ok: true, timelines: await getAllTimelines(req.userId!) })
  })

  r.get('/api/timeline/:messageId', async (req, res) => {
    res.json({ ok: true, timeline: await getTimeline(req.userId!, Number(req.params.messageId)) })
  })

  // 沟通日志(小弟 ↔ Jarvis)
  r.get('/api/comms', async (req, res) => {
    res.json({ ok: true, comms: await getComms(req.userId!) })
  })

  // ── 运行面板(P6):消息处理流水 / 队列 / 事件源心跳 ──
  r.get('/api/traces', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const items = await docList(req.userId!, 'mtrace', '', limit)
    res.json({ ok: true, traces: items.map(i => i.data) })
  })

  r.get('/api/traces/:id', async (req, res) => {
    const t = await docGet(req.userId!, 'mtrace', req.params.id)
    if (!t) { res.status(404).json({ ok: false, error: 'trace 不存在' }); return }
    res.json({ ok: true, trace: t })
  })

  r.get('/api/queue', (req, res) => {
    res.json({ ok: true, ...getQueueStatus(req.userId!) })
  })

  r.get('/api/heartbeat', async (req, res) => {
    const jdsme = getJdMeRuntimeInfo()
    const xingyun = getXingyunRuntimeInfo()
    res.json({ ok: true, jdsme, xingyun, counters: getCounters(), since: 'boot' })
  })

  return r
}
