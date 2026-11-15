import { listUsers } from '../auth/users.js'
import { listAdhocAgents } from '../a2a/adhoc.js'
import { listRecipes } from '../team/registry.js'
import { pushProactiveMessage } from './proactive.js'
import { docGet, docPut } from '../shared/docs.js'
import { getSettings } from './persona.js'

/**
 * 转正巡检 —— 补「Jarvis 忘了推荐」的洞。
 *
 * 设计意图:临时工累计 ≥3 次就该转正,原来的机制是任务汇报时顺带塞一句推荐
 * (buildPromoteNote),依赖 Jarvis 汇报时还记得说。真实运行里它经常不说——
 * 「技术调研」都干 4 次了还在打临时工。这里加一条独立的定时巡检:达线就
 * 直接主动推给 Sir,不经过 Jarvis 的自觉。
 *
 * 只提醒不自动转正:转正 = Jarvis 推荐 + Sir 确认(promote_agent),这条纪律不变。
 * 提醒文案直接附上 promote 指令,Sir 回一句"转"就能办。
 *
 * 防重复打扰:已提醒状态落文档表(kind='promotion-reminded'),进程重启不再忘记。
 * 同一 domain 7 天内只提醒一次 —— 转正是低频决策,反复弹同一句只会变噪音
 * (真实反馈:8 点提醒一次,重启后 9 点、10 点又各弹一次)。
 */

const READY_LINE = 3          // 与 buildPromoteNote / get_team_stats 同阈值
const DEFAULT_INTERVAL_MIN = 60 // 默认每小时巡一次(可在配置页「定时任务」里改)
const RE_NAG_MS = 7 * 24 * 60 * 60_000 // 同一 domain 7 天内不重复提醒
const REMINDED_KIND = 'promotion-reminded'

let timer: ReturnType<typeof setInterval> | null = null
const reminded = new Set<string>() // `${userId}:${domain}` 进程内快照(持久层之外的加速)

/** 读已提醒记录:domain → 上次提醒时间戳。读失败按空处理(宁可多提醒一次,不断巡检)。 */
async function loadReminded(userId: string): Promise<Record<string, number>> {
  const doc = await docGet<{ domains?: Record<string, number> }>(userId, REMINDED_KIND, 'state').catch(() => null)
  const domains = doc?.domains
  if (!domains || typeof domains !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [domain, at] of Object.entries(domains)) {
    const ts = Number(at)
    if (domain && Number.isFinite(ts)) out[domain] = ts
  }
  return out
}

/** 纯函数判定(单测覆盖):给定临时工列表,返回本次该提醒的 domain 清单。 */
export function evaluatePromotionCandidates(
  adhocs: Array<{ domain: string; taskCount: number }>,
  existingDomains: Set<string>,
  alreadyReminded: Set<string>,
): string[] {
  return adhocs
    .filter(a => a.taskCount >= READY_LINE && !existingDomains.has(a.domain) && !alreadyReminded.has(a.domain))
    .map(a => a.domain)
}

async function checkUser(userId: string): Promise<void> {
  const [adhocs, recipes] = await Promise.all([
    listAdhocAgents(userId).catch(() => []),
    listRecipes(userId).catch(() => []),
  ])
  if (adhocs.length === 0) return
  // 已有同名 domain 的正式小弟 → 不用再提醒(转正的意义就是固化它)
  const existingDomains = new Set(recipes.map(r => r.context?.domain).filter((d): d is string => typeof d === 'string'))
  // 去重集合 = 持久层里 7 天内提醒过的 + 本进程内刚提醒的
  const stored = await loadReminded(userId)
  const now = Date.now()
  const recentlyReminded = new Set(
    Object.entries(stored)
      .filter(([, at]) => now - at < RE_NAG_MS)
      .map(([domain]) => domain),
  )
  for (const key of reminded) {
    if (key.startsWith(`${userId}:`)) recentlyReminded.add(key.slice(userId.length + 1))
  }
  const ready = evaluatePromotionCandidates(adhocs, existingDomains, recentlyReminded)

  let changed = false
  for (const domain of ready) {
    const agent = adhocs.find(a => a.domain === domain)
    const count = agent?.taskCount ?? READY_LINE
    const text = `Sir,「${domain}」领域的临时工已经干了 ${count} 次活,按规矩该转正了——转正后这个领域的活儿都优先派他,还能带上完整记忆。要转的话说一声,我让管家走 promote 流程(会给他起个名字)。`
    const pushed = await pushProactiveMessage(userId, text).catch(() => false)
    if (pushed) {
      reminded.add(`${userId}:${domain}`)
      stored[domain] = Date.now()
      changed = true
      console.log(`[promotion-watch] 已提醒转正候选: userId=${userId.slice(0, 8)} domain=${domain} (${count} 次)`)
    }
  }
  if (changed) {
    await docPut(userId, REMINDED_KIND, 'state', { domains: stored }).catch(() => {})
  }
}

export function startPromotionWatch(): void {
  if (timer) return
  const cfg = getSettings().promotionWatch
  if (cfg.enabled === false) {
    console.log('[promotion-watch] 配置中已停用,不启动')
    return
  }
  const intervalMin = Number.isFinite(cfg.intervalMin) && cfg.intervalMin > 0 ? cfg.intervalMin : DEFAULT_INTERVAL_MIN
  timer = setInterval(() => {
    ;(async () => {
      const users = await listUsers()
      for (const u of users) {
        try {
          await checkUser(u.id)
        } catch (err) {
          console.error('[promotion-watch] 用户巡检失败:', err instanceof Error ? err.message : err)
        }
      }
    })().catch(err => console.error('[promotion-watch] 巡检失败:', err instanceof Error ? err.message : err))
  }, intervalMin * 60_000)
  console.log(`[promotion-watch] 已启动:每 ${intervalMin} 分钟巡检临时工,≥${READY_LINE} 次且无同名正式小弟时提醒 Sir`)
}

/** 配置变更后重载(启停/间隔),保存即生效。 */
export function reloadPromotionWatch(): void {
  if (timer) { clearInterval(timer); timer = null }
  startPromotionWatch()
}

export function stopPromotionWatch(): void {
  if (timer) { clearInterval(timer); timer = null }
}

export const _internals = { reminded, READY_LINE, DEFAULT_INTERVAL_MIN }
