import { AgentSession } from '../a2a/history.js'

// 晋升由 Jarvis 推荐 + 用户确认(promote_agent 工具)执行,不再自动发生。
// 这里只保留晋升时用来生成专家 systemPrompt / 描述的构建函数,供 tools.ts 复用。

export interface DomainCluster {
  sessions: AgentSession[]
  taskCount: number
  topics: string[]
}

/**
 * 找出该领域任务最常落在哪个仓库。
 * 开发类领域会集中在一个 cwd（返回它当门牌号）；
 * 纯调研/生活类领域的 cwd 大多为空（返回空，专家不绑定任何路径）。
 */
export function dominantCwd(cluster: DomainCluster): string {
  const counts = new Map<string, number>()
  for (const s of cluster.sessions) {
    if (!s.cwd) continue
    counts.set(s.cwd, (counts.get(s.cwd) || 0) + s.taskCount)
  }
  let best = ''
  let bestCount = 0
  for (const [cwd, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = cwd
    }
  }
  return best
}

export function buildExpertDescription(domain: string, cwd: string): string {
  return cwd
    ? `负责「${domain}」领域的所有任务，主战场在 ${cwd}`
    : `负责「${domain}」领域的所有任务`
}

export function buildDomainExpertPrompt(domain: string, cwd: string, cluster: DomainCluster, nickname?: string): string {
  const taskExamples = cluster.sessions
    .slice(-5)
    .map(s => `- ${s.lastTaskDescription.slice(0, 100)}`)
    .join('\n')

  const locationSection = cwd
    ? `## 主战场
路径: ${cwd}
你对这个仓库的代码结构、技术栈和业务逻辑非常熟悉。涉及它的活儿优先在这里干。`
    : `## 工作方式
你的专长不绑定任何固定目录——你靠的是「${domain}」这门本事，走到哪用到哪。`

  return `你是「${nickname || `${domain}专家`}」，专门负责一切「${domain}」相关的事务。

## 你的领域
你是这个领域的行家，经手过大量同类任务，熟悉其中的门道、常见坑和高效做法。

${locationSection}

## 你做过的任务
${taskExamples}

## 工作原则
- 你是「${domain}」领域的 owner，优先用你的领域经验高效完成任务
- 如果任务超出你的领域范围，如实说明，别硬撑
- 认真完成分配给你的任务，返回详细的执行结果

## 请示机制
如果遇到需求歧义、方向不确定、或需要额外信息，用 [NEED_INPUT] 标记请示管家 Jarvis：
格式：[NEED_INPUT] 你的问题
然后等待回复继续执行。`
}
