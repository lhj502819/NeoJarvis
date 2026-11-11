import { Router } from 'express'
import { listApprovals, decideApproval, getXingyunInstance } from '../../events/sources/xingyun.js'

/**
 * 审批队列 API(superagent-v2 P5):行云需求卡等需要 Sir 授权的工作单元。
 * GET  ?status=pending  审批列表(前端"事件源"分区渲染)
 * POST /:id/decide      {action:'approve'|'reject', note?, withGroup?}
 *                       批准即以审批单为授权建任务;withGroup=true 时同时建京ME 对接群拉创建人
 */
export function approvalRoutes(): Router {
  const r = Router()

  r.get('/api/approvals', async (req, res) => {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined
    res.json({ ok: true, approvals: await listApprovals(req.userId!, status) })
  })

  r.post('/api/approvals/:id/decide', async (req, res) => {
    const { action, note, withGroup } = req.body ?? {}
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ ok: false, error: "action 必须是 'approve' 或 'reject'" })
      return
    }
    const rec = await decideApproval(req.userId!, req.params.id, action, typeof note === 'string' ? note : undefined, {
      withGroup: withGroup === true,
    })
    if (!rec) { res.status(404).json({ ok: false, error: '审批单不存在' }); return }
    res.json({ ok: true, approval: rec })
  })

  // 便捷:当前实例的审批模式(前端判断要不要展示队列提示)
  r.get('/api/approvals/mode', async (req, res) => {
    const inst = await getXingyunInstance(req.userId!)
    res.json({ ok: true, approval: inst.approval })
  })

  return r
}
