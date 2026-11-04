import { addToBuffer } from './conversation.js'
import { broadcast } from './sse.js'

/**
 * 主动消息(Watchdog 提醒 / 定时晨报 / 事件通知)的统一出口。
 *
 * 产品规则(docs/superagent-design.md §Watchdog):
 *   - 免打扰时段(默认 23:00–08:00)只记录不推送
 *   - 全局频控:每小时最多 N 条主动打扰
 *   - 推送 = 落库(jarvis 角色)+ /events 广播 —— 前端 applyLiveEvent 会渲染成
 *     Jarvis 的独立气泡(非 live-reply source,不会覆盖当前对话)
 */

const QUIET_START_HOUR = Number(process.env.JARVIS_QUIET_START_HOUR ?? 23)
const QUIET_END_HOUR = Number(process.env.JARVIS_QUIET_END_HOUR ?? 8)
const HOURLY_PUSH_CAP = Number(process.env.JARVIS_PROACTIVE_HOURLY_CAP ?? 3)

let pushedThisHour = 0
let hourBucket = Math.floor(Date.now() / 3_600_000)

function isQuietHours(now = new Date()): boolean {
  const h = now.getHours()
  if (QUIET_START_HOUR > QUIET_END_HOUR) return h >= QUIET_START_HOUR || h < QUIET_END_HOUR
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR
}

function underRateCap(now = new Date()): boolean {
  const bucket = Math.floor(now.getTime() / 3_600_000)
  if (bucket !== hourBucket) {
    hourBucket = bucket
    pushedThisHour = 0
  }
  return pushedThisHour < HOURLY_PUSH_CAP
}

/**
 * 推一条主动消息。返回 false 表示被静默时段/频控拦下(调用方自行决定是否降级为仅日志)。
 * force=true 跳过频控与免打扰(留给用户明确在等的场景,目前不使用)。
 */
export async function pushProactiveMessage(userId: string, text: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const now = new Date()
  if (!opts.force) {
    if (isQuietHours(now)) {
      console.log(`[proactive] 免打扰时段,仅记录不推送: userId=${userId} "${text.slice(0, 60)}"`)
      return false
    }
    if (!underRateCap(now)) {
      console.log(`[proactive] 触及每小时主动消息上限(${HOURLY_PUSH_CAP}),丢弃: "${text.slice(0, 60)}"`)
      return false
    }
  }
  pushedThisHour += 1
  // 落库成 jarvis 消息(历史/刷新可见)→ /events 广播(前端气泡)
  await addToBuffer(userId, 'jarvis', text)
  broadcast('response', text, userId)
  return true
}

/** 判定导出(测试用) */
export const _internals = { isQuietHours, underRateCap }
