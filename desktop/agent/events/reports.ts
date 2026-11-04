import { listTasks, getActiveTasks } from '../task/manager.js'

/**
 * 定时晨报(M2c):昨夜收工 + 还在跑 + 卡住的 + 一句话提醒。
 * 纯程序组装(零 LLM 成本、稳定可靠);LLM 润色后置。
 */
export async function generateMorningReport(userId: string): Promise<string> {
  const now = Date.now()
  const dayMs = 24 * 3_600_000
  const tasks = await listTasks(userId)
  const active = await getActiveTasks(userId)

  const recentDone = tasks.filter(t =>
    (t.status === 'completed') && Date.parse(t.updatedAt) > now - dayMs)
  const recentFailed = tasks.filter(t =>
    (t.status === 'failed') && Date.parse(t.updatedAt) > now - dayMs)
  const running = active.filter(t => t.status === 'executing')
  const blocked = active.filter(t => t.status === 'blocked')

  const lines: string[] = ['早,Sir。晨报:']

  if (recentDone.length > 0) {
    lines.push(`昨晚收工 ${recentDone.length} 单:${recentDone.map(t => `「${t.name}」`).join('、')} ✓`)
  }
  if (running.length > 0) {
    lines.push(`还在跑 ${running.length} 单:${running.map(t => `「${t.name}」`).join('、')},我盯着呢。`)
  }
  if (blocked.length > 0) {
    lines.push(`卡住 ${blocked.length} 单:${blocked.map(t => `「${t.name}」`).join('、')}——要不要我催一下?`)
  }
  if (recentFailed.length > 0) {
    lines.push(`昨晚有 ${recentFailed.length} 单失败:${recentFailed.map(t => `「${t.name}」`).join('、')},得空看看错因。`)
  }

  if (lines.length === 1) {
    lines.push('一切安好,没有挂着的活。今天想干点什么?')
  } else {
    lines.push('有事随时吩咐。')
  }
  return lines.join('\n')
}
