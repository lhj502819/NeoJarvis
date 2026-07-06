import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { listRecipes } from '../team/registry.js'
import { listTasks, getTask } from '../task/manager.js'
import { listAgentSessions, getSessionsByDomain } from '../a2a/history.js'
import db from '../shared/db.js'

export function createJarvisTools(userId: string) {
  return createSdkMcpServer({
    name: 'jarvis-system',
    alwaysLoad: true,
    tools: [
      tool('list_team', '查看当前团队成员（小弟）列表，包括已转正和临时的', {},
        async () => {
          const recipes = listRecipes(userId)
          const summary = recipes.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description,
            domain: r.context?.domain || '',
            persistent: r.persistent,
            usageCount: r.usageCount,
          }))
          return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] }
        }
      ),

      tool('list_tasks', '查看任务列表，可按状态筛选', { status: z.string().optional().describe('可选：created|executing|completed|failed|cancelled') },
        async (args) => {
          let tasks = listTasks(userId)
          if (args.status) {
            tasks = tasks.filter(t => t.status === args.status)
          }
          const summary = tasks.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            subtaskCount: t.subtasks.length,
            createdAt: t.createdAt,
          }))
          return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] }
        }
      ),

      tool('get_task', '查看单个任务的完整详情（含子任务）', { taskId: z.string().describe('任务ID') },
        async (args) => {
          const task = getTask(userId, args.taskId)
          if (!task) {
            return { content: [{ type: 'text' as const, text: '未找到该任务' }] }
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
        }
      ),

      tool('list_agent_history', '查看 agent 执行历史记录，可按领域筛选', { domain: z.string().optional().describe('可选：按领域筛选，如"技术调研"') },
        async (args) => {
          const sessions = args.domain
            ? getSessionsByDomain(userId, args.domain)
            : listAgentSessions(userId)
          const summary = sessions.map(s => ({
            sessionId: s.sessionId,
            domain: s.domain,
            lastTask: s.lastTaskDescription,
            taskCount: s.taskCount,
            completedAt: s.completedAt,
          }))
          return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] }
        }
      ),

      tool('get_team_stats', '查看团队统计：各领域执行次数、已转正/待转正情况', {},
        async () => {
          const recipes = listRecipes(userId)
          const persistent = recipes.filter(r => r.persistent)
          const temporary = recipes.filter(r => !r.persistent)

          const domainStats = db.prepare(`
            SELECT domain, COUNT(*) as task_count
            FROM jarvis_claude_sessions
            WHERE user_id = ? AND domain != ''
            GROUP BY domain
            ORDER BY task_count DESC
          `).all(userId) as Array<{ domain: string; task_count: number }>

          const stats = {
            totalMembers: recipes.length,
            persistent: persistent.map(r => ({ name: r.name, domain: r.context?.domain || '', usageCount: r.usageCount })),
            temporary: temporary.map(r => ({ name: r.name, domain: r.context?.domain || '', usageCount: r.usageCount, needForPromotion: Math.max(0, 3 - r.usageCount) })),
            domainActivity: domainStats,
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] }
        }
      ),
    ],
  })
}
