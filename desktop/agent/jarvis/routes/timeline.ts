import { Router } from 'express'
import { getAllTimelines, getTimeline, getComms } from '../timeline-store.js'

/**
 * 对话流时间线/沟通日志读取(刷新还原用)。
 * 写入侧:brain.ts think() 落盘时间线;agent-comms / send_message 追加沟通日志。
 */
export function timelineRoutes(): Router {
  const r = Router()

  // 该用户全部消息时间线(刷新后一次性拉取,前端按 message_id 对齐)
  r.get('/api/timeline/all', (req, res) => {
    res.json({ ok: true, timelines: getAllTimelines(req.userId!) })
  })

  r.get('/api/timeline/:messageId', (req, res) => {
    res.json({ ok: true, timeline: getTimeline(req.userId!, Number(req.params.messageId)) })
  })

  // 沟通日志(小弟 ↔ Jarvis)
  r.get('/api/comms', (req, res) => {
    res.json({ ok: true, comms: getComms(req.userId!) })
  })

  return r
}
