import { listUsers } from '../auth/users.js'
import { listAdhocAgents } from '../a2a/adhoc.js'
import { listRecipes } from '../team/registry.js'
import { pushProactiveMessage } from './proactive.js'

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
 * 防重复打扰:一个 domain 提醒过一次后记入已提醒集合(进程内;重启后最多再提一次,
 * 可接受——巡检周期长,提醒本身低频)。
 */

const READY_LINE = 3          // 与 buildPromoteNote / get_team_stats 同阈值
const CHECK_INTERVAL_MIN = 60 // 每小时巡一次;转正是低频事件,不值得更密

let timer: ReturnType<typeof setInterval> | null = null
const reminded = new Set<string>() // `${userId}:${domain}`

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
  const ready = evaluatePromotionCandidates(adhocs, existingDomains, reminded)

  for (const domain of ready) {
    const agent = adhocs.find(a => a.domain === domain)
    const count = agent?.taskCount ?? READY_LINE
    const text = `Sir,「${domain}」领域的临时工已经干了 ${count} 次活,按规矩该转正了——转正后这个领域的活儿都优先派他,还能带上完整记忆。要转的话说一声,我让管家走 promote 流程(会给他起个名字)。`
    const pushed = await pushProactiveMessage(userId, text).catch(() => false)
    if (pushed) {
      reminded.add(`${userId}:${domain}`)
      console.log(`[promotion-watch] 已提醒转正候选: userId=${userId.slice(0, 8)} domain=${domain} (${count} 次)`)
    }
  }
}

export function startPromotionWatch(): void {
  if (timer) return
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
  }, CHECK_INTERVAL_MIN * 60_000)
  console.log(`[promotion-watch] 已启动:每 ${CHECK_INTERVAL_MIN} 分钟巡检临时工,≥${READY_LINE} 次且无同名正式小弟时提醒 Sir`)
}

export function stopPromotionWatch(): void {
  if (timer) { clearInterval(timer); timer = null }
}

export const _internals = { reminded, READY_LINE, CHECK_INTERVAL_MIN }
