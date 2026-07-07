import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { listRecipes } from '../team/registry.js'
import { listTasks, getTask } from '../task/manager.js'
import { listAgentSessions, getSessionsByDomain } from '../a2a/history.js'
import { addMcpServer, listMcpServers, removeMcpServer } from '../auth/mcp-servers.js'
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

      // ═══ MCP servers 管理（全对话式）═══
      tool(
        'add_mcp_server',
        '添加一个外部 MCP server。全局共享给所有小弟按需使用。' +
          'stdio 类型需要 command（可选 args、env）；sse/http 类型需要 url（env 里的 Authorization/TOKEN/API_KEY 会转为 Authorization header）。' +
          'env 用于存 API token 等敏感数据，加密存储，绝不明文回传。' +
          '成功后请告知用户：token 已加密存好；但用户在聊天里贴的那条 token 消息仍保留在聊天记录里（喂给 LLM 和长记忆前会自动 redact），如需彻底清除请手动删除那条消息。',
        {
          name: z.string().describe('MCP server 名称（用户可见，用来后续增删改），如 github、slack'),
          transport: z.enum(['stdio', 'sse', 'http']).describe('传输类型'),
          command: z.string().optional().describe('stdio: 可执行命令，如 npx'),
          args: z.array(z.string()).optional().describe('stdio: 命令参数数组'),
          url: z.string().optional().describe('sse/http: 端点 URL'),
          env: z.record(z.string(), z.string()).optional().describe('环境变量/鉴权信息，加密存储'),
          description: z.string().optional().describe('简短描述，帮小弟理解这个 MCP 是干嘛的'),
        },
        async (args) => {
          try {
            const s = addMcpServer(userId, {
              name: args.name,
              transport: args.transport,
              command: args.command,
              args: args.args,
              url: args.url,
              env: args.env,
              description: args.description,
            })
            return {
              content: [{
                type: 'text' as const,
                text: `已添加 MCP server「${s.name}」（${s.transport}）。已加密存储 ${s.envKeys.length} 个环境变量：${s.envKeys.join(', ') || '（无）'}。`,
              }],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `添加失败：${e instanceof Error ? e.message : String(e)}` }] }
          }
        }
      ),

      tool(
        'list_mcp_servers',
        '查看当前用户已配置的 MCP servers（脱敏：env 只回 key 名不回值）',
        {},
        async () => {
          const servers = listMcpServers(userId)
          if (servers.length === 0) {
            return { content: [{ type: 'text' as const, text: '当前未配置任何 MCP server。' }] }
          }
          const summary = servers.map(s => ({
            name: s.name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            url: s.url,
            envKeys: s.envKeys,
            description: s.description,
            enabled: s.enabled,
          }))
          return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] }
        }
      ),

      tool(
        'remove_mcp_server',
        '按 name 删除一个 MCP server',
        { name: z.string().describe('要删除的 MCP server name') },
        async (args) => {
          const ok = removeMcpServer(userId, args.name)
          return {
            content: [{
              type: 'text' as const,
              text: ok ? `已删除 MCP server「${args.name}」。` : `未找到名为「${args.name}」的 MCP server。`,
            }],
          }
        }
      ),
    ],
  })
}
