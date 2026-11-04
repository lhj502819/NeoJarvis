import { listUsers } from '../../auth/users.js'
import type { EventSourceDef, JarvisEvent } from '../types.js'

/**
 * Cron 源(M2c):定时晨报。默认每日 09:00,env JARVIS_MORNING_REPORT_AT 可改("HH:MM",留空停用)。
 * 无外部依赖 —— 事件框架的第一个真实数据源,验证 emit → router → 落地全链路。
 */
export function createCronSource(): EventSourceDef {
  let timer: NodeJS.Timeout | null = null
  return {
    id: 'cron',
    start(ctx) {
      const at = process.env.JARVIS_MORNING_REPORT_AT ?? '09:00'
      if (!at.trim()) {
        console.log('[events] cron 源:JARVIS_MORNING_REPORT_AT 为空,晨报停用')
        return
      }
      const schedule = () => {
        const [h, m] = at.split(':').map(Number)
        const now = new Date()
        const next = new Date()
        next.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0)
        if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
        const delay = next.getTime() - now.getTime()
        timer = setTimeout(() => {
          void (async () => {
            try {
              const users = await listUsers()
              for (const u of users) {
                ctx.emit({
                  id: `cron-morning-${Date.now()}-${u.id}`,
                  source: 'cron',
                  type: 'morning_report',
                  userId: u.id,
                  payload: {},
                  receivedAt: Date.now(),
                })
              }
            } catch (err) {
              console.error('[events] cron 源发事件失败:', err instanceof Error ? err.message : err)
            } finally {
              schedule()  // 排下一天
            }
          })()
        }, delay)
        console.log(`[events] cron 源:晨报每日 ${at},下一次 ${next.toLocaleString('zh-CN')}`)
      }
      schedule()
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
