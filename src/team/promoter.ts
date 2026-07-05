import { listAgentSessions, AgentSession } from '../a2a/history.js'
import { listRecipes, createRecipe } from './registry.js'
import { broadcast } from '../jarvis/agent.js'
import { basename } from 'path'

const PROMOTION_THRESHOLD = 3

export function evaluatePromotion(): void {
  const sessions = listAgentSessions()
  if (sessions.length < PROMOTION_THRESHOLD) return

  const existingRecipes = listRecipes()
  const existingCwds = new Set(
    existingRecipes.map(r => r.context.cwd as string).filter(Boolean)
  )

  const projectClusters = clusterByProject(sessions)

  for (const [cwd, cluster] of projectClusters) {
    if (cluster.taskCount < PROMOTION_THRESHOLD) continue
    if (!cwd || cwd === '/') continue
    if (existingCwds.has(cwd)) continue

    const projectName = inferProjectName(cwd)

    const recipe = createRecipe({
      name: `${projectName}专家`,
      description: `负责项目 ${projectName} (${cwd}) 的所有开发任务`,
      systemPrompt: buildProjectExpertPrompt(projectName, cwd, cluster),
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      context: { cwd },
      persistent: true,
    })

    broadcast('progress', `🎓 新小弟入队：「${projectName}专家」(在该项目已执行 ${cluster.taskCount} 次任务，沉淀为专属 agent)`)
    return
  }
}

interface ProjectCluster {
  sessions: AgentSession[]
  taskCount: number
  topics: string[]
}

function clusterByProject(sessions: AgentSession[]): Map<string, ProjectCluster> {
  const map = new Map<string, ProjectCluster>()

  for (const session of sessions) {
    if (!session.cwd) continue

    const existing = map.get(session.cwd)
    if (existing) {
      existing.sessions.push(session)
      existing.taskCount += session.taskCount
      existing.topics = [...new Set([...existing.topics, ...session.topics])].slice(0, 20)
    } else {
      map.set(session.cwd, {
        sessions: [session],
        taskCount: session.taskCount,
        topics: [...session.topics],
      })
    }
  }

  return map
}

function inferProjectName(cwd: string): string {
  const name = basename(cwd)
  return name || '未命名项目'
}

function buildProjectExpertPrompt(projectName: string, cwd: string, cluster: ProjectCluster): string {
  const taskExamples = cluster.sessions
    .slice(-5)
    .map(s => `- ${s.lastTaskDescription.slice(0, 100)}`)
    .join('\n')

  return `你是「${projectName}专家」，专门负责项目 ${projectName} 的一切事务。

## 项目信息
路径: ${cwd}
你对这个项目非常熟悉，了解它的代码结构、技术栈和业务逻辑。

## 你做过的任务
${taskExamples}

## 工作原则
- 你是这个项目的owner，对它的代码和架构了如指掌
- 执行任务时优先利用你对项目的理解，高效完成
- 如果任务涉及你不熟悉的其他项目，如实说明
- 认真完成分配给你的任务，返回详细的执行结果

## 请示机制
如果遇到需求歧义、方向不确定、或需要额外信息，用 [NEED_INPUT] 标记请示管家 Jarvis：
格式：[NEED_INPUT] 你的问题
然后等待回复继续执行。`
}
