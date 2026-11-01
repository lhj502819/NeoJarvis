import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { listRecipes, createRecipe } from '../team/registry.js'
import { listTasks, getTask, createTask, updateTask } from '../task/manager.js'
import { interruptAgent } from '../a2a/client.js'
import { bus } from '../a2a/bus.js'
import { listAgentSessions, getSessionsByDomain } from '../a2a/history.js'
import { addMcpServer, listMcpServers, removeMcpServer } from '../auth/mcp-servers.js'
import { getAdhocAgent, markAdhocPromoted, listAdhocAgents } from '../a2a/adhoc.js'
import { buildDomainExpertPrompt, buildExpertDescription, dominantCwd, type DomainCluster } from '../team/promoter.js'
import { broadcast } from './sse.js'
import { pinArtifact, getPinnedArtifactId } from './orchestrator.js'
import { serverGet, serverPatch } from '../shared/server-client.js'
import { getArtifactContent, type ArtifactRecord } from '../shared/artifact-content.js'

/**
 * Artifact detail as returned by the Java server (GET/PATCH /api/artifact/{id}).
 * v0.3: the server now sends EITHER `content` (legacy row) OR `uri` (new row);
 * `getArtifactContent` / `materialise` normalise that into a plain string for tool code.
 */
type ArtifactRow = ArtifactRecord

/** Java 404 (server-client throws with the status baked into the message). */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

export interface PendingArtifact {
  type: 'html' | 'markdown' | 'code' | 'mermaid'
  title: string
  content: string
  language?: string
}

const pendingArtifacts = new Map<string, PendingArtifact>()

export function consumeArtifact(userId: string): PendingArtifact | null {
  const artifact = pendingArtifacts.get(userId) || null
  pendingArtifacts.delete(userId)
  return artifact
}

export interface PromotePersona {
  nickname?: string
  avatar?: string
  description?: string
}

export async function promoteAdhocToRecipe(userId: string, domain: string, persona?: PromotePersona): Promise<{ ok: boolean; message: string }> {
  const adhoc = await getAdhocAgent(userId, domain)
  if (!adhoc) return { ok: false, message: `「${domain}」领域暂无临时工记录,无法转正。` }
  if (adhoc.promoted) return { ok: false, message: `「${domain}」领域已有正式小弟。` }

  const sessions = await getSessionsByDomain(userId, domain)
  const cluster: DomainCluster = {
    sessions,
    taskCount: adhoc.taskCount,
    topics: adhoc.topics,
  }
  const cwd = adhoc.cwd || dominantCwd(cluster)

  // 拟人化身份:Jarvis 起的昵称/头像/描述优先;没给就退回功能名模板(兜底,不阻塞转正)
  const nickname = persona?.nickname?.trim() || `${domain}专家`
  const description = persona?.description?.trim() || buildExpertDescription(domain, cwd)
  const avatar = persona?.avatar?.trim() || undefined

  await createRecipe(userId, {
    name: nickname,
    description,
    systemPrompt: buildDomainExpertPrompt(domain, cwd, cluster, nickname),
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    skills: [],
    context: cwd ? { domain, cwd } : { domain },
    persistent: true,
    avatar,
  })
  await markAdhocPromoted(userId, domain)

  const where = cwd ? `(主战场:${cwd})` : ''
  broadcast('progress', `🎓 新小弟入队:「${nickname}」${avatar || ''}${where} — 由 Sir 拍板转正`, userId)
  return { ok: true, message: `已把「${domain}」临时工转正为正式小弟「${nickname}」。` }
}

/**
 * Jarvis 本体工具集(团队/任务/制品/MCP 管理 + 任务派发)。
 *
 * 迁移自 Claude Agent SDK 的 createSdkMcpServer + tool()。
 * Pi 不用 MCP,工具通过 defineTool() 定义成 ToolDefinition 数组,
 * 由调用方(jarvis/llm.ts)经 createAgentSession({ customTools }) 挂载。
 */
export function createJarvisTools(userId: string): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_team',
      label: 'List Team',
      description: '查看当前团队成员（小弟）列表，包括已转正和临时的',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params) => {
          const recipes = await listRecipes(userId)
          const summary = recipes.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description,
            domain: r.context?.domain || '',
            persistent: r.persistent,
            usageCount: r.usageCount,
          }))
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'list_tasks',
      label: 'List Tasks',
      description: '查看任务列表，可按状态筛选',
      parameters: Type.Object({
        status: Type.Optional(Type.String({ description: '可选：created|executing|completed|failed|cancelled' })),
      }),
      execute: async (_toolCallId, params) => {
          let tasks = await listTasks(userId)
          if (params.status) {
            tasks = tasks.filter(t => t.status === params.status)
          }
          const summary = tasks.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            subtaskCount: t.subtasks.length,
            createdAt: t.createdAt,
          }))
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'get_task',
      label: 'Get Task',
      description: '查看单个任务的完整详情（含子任务）',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务ID' }),
      }),
      execute: async (_toolCallId, params) => {
          const task = await getTask(userId, params.taskId)
          if (!task) {
            return { content: [{ type: 'text', text: '未找到该任务' }], details: {} }
          }
          return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'list_agent_history',
      label: 'List Agent History',
      description: '查看 agent 执行历史记录，可按领域筛选',
      parameters: Type.Object({
        domain: Type.Optional(Type.String({ description: '可选：按领域筛选，如"技术调研"' })),
      }),
      execute: async (_toolCallId, params) => {
          const sessions = params.domain
            ? await getSessionsByDomain(userId, params.domain)
            : await listAgentSessions(userId)
          const summary = sessions.map(s => ({
            sessionId: s.sessionId,
            domain: s.domain,
            lastTask: s.lastTaskDescription,
            taskCount: s.taskCount,
            completedAt: s.completedAt,
          }))
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'get_team_stats',
      label: 'Get Team Stats',
      description: '查看团队统计:正式小弟、临时工(按领域聚合的待转正候选)、各领域活跃度',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params) => {
          const recipes = await listRecipes(userId)
          const persistent = recipes.filter(r => r.persistent)
          const adhocs = await listAdhocAgents(userId)  // 仅 promoted=0

          const stats = {
            totalMembers: persistent.length,
            persistent: persistent.map(r => ({ name: r.name, domain: r.context?.domain || '', usageCount: r.usageCount })),
            adhocCandidates: adhocs.map(a => ({
              domain: a.domain,
              taskCount: a.taskCount,
              readyToPromote: a.taskCount >= 3,
              lastTask: a.lastTaskDescription.slice(0, 60),
            })),
          }
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'promote_agent',
      label: 'Promote Agent',
      description: '把某个领域的临时工转正为正式小弟(persistent 专家)。仅在用户确认转正后调用。' +
        '转正时你要为这位新同事塑造拟人形象:起一个像真人同事的昵称、选一个贴切 emoji 当头像、写一句拟人化的自我介绍。',
      parameters: Type.Object({
        domain: Type.String({ description: '要转正的领域名,如"技术调研"' }),
        nickname: Type.Optional(Type.String({ description: '拟人昵称(2-3 字,像同事名不像职能,如"阿档""小差""老账"。不填则退回"XX专家")' })),
        avatar: Type.Optional(Type.String({ description: '单个 emoji 当头像,贴合领域(如技术调研 🔍、财务整理 📊、差旅出行 ✈️)' })),
        description: Type.Optional(Type.String({ description: '一句拟人化自我介绍(如"文档堆里长大的,再乱的资料我都能理出头绪")' })),
      }),
      execute: async (_toolCallId, params) => {
          const res = await promoteAdhocToRecipe(userId, params.domain, {
            nickname: params.nickname,
            avatar: params.avatar,
            description: params.description,
          })
          return { content: [{ type: 'text', text: res.message }], details: {} }
      },
    }),

    // ═══ MCP servers 管理（全对话式）═══
    defineTool({
      name: 'add_mcp_server',
      label: 'Add MCP Server',
      description: '添加一个外部 MCP server。全局共享给所有小弟按需使用。' +
          'stdio 类型需要 command（可选 args、env）；sse/http 类型需要 url（env 里的 Authorization/TOKEN/API_KEY 会转为 Authorization header）。' +
          'env 用于存 API token 等敏感数据，加密存储，绝不明文回传。' +
          '成功后请告知用户：token 已加密存好；但用户在聊天里贴的那条 token 消息仍保留在聊天记录里（喂给 LLM 和长记忆前会自动 redact），如需彻底清除请手动删除那条消息。',
      parameters: Type.Object({
        name: Type.String({ description: 'MCP server 名称（用户可见，用来后续增删改），如 github、slack' }),
        transport: Type.Union([Type.Literal('stdio'), Type.Literal('sse'), Type.Literal('http')], { description: '传输类型' }),
        command: Type.Optional(Type.String({ description: 'stdio: 可执行命令，如 npx' })),
        args: Type.Optional(Type.Array(Type.String(), { description: 'stdio: 命令参数数组' })),
        url: Type.Optional(Type.String({ description: 'sse/http: 端点 URL' })),
        env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: '环境变量/鉴权信息，加密存储' })),
        description: Type.Optional(Type.String({ description: '简短描述，帮小弟理解这个 MCP 是干嘛的' })),
      }),
      execute: async (_toolCallId, params) => {
          try {
            const s = await addMcpServer(userId, {
              name: params.name,
              transport: params.transport,
              command: params.command,
              args: params.args,
              url: params.url,
              env: params.env,
              description: params.description,
            })
            return {
              content: [{
                type: 'text',
                text: `已添加 MCP server「${s.name}」（${s.transport}）。已加密存储 ${s.envKeys.length} 个环境变量：${s.envKeys.join(', ') || '（无）'}。`,
              }],
              details: {},
            }
          } catch (e) {
            return { content: [{ type: 'text', text: `添加失败：${e instanceof Error ? e.message : String(e)}` }], details: {} }
          }
      },
    }),

    defineTool({
      name: 'list_mcp_servers',
      label: 'List MCP Servers',
      description: '查看当前用户已配置的 MCP servers（脱敏：env 只回 key 名不回值）',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params) => {
          const servers = await listMcpServers(userId)
          if (servers.length === 0) {
            return { content: [{ type: 'text', text: '当前未配置任何 MCP server。' }], details: {} }
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
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'remove_mcp_server',
      label: 'Remove MCP Server',
      description: '按 name 删除一个 MCP server',
      parameters: Type.Object({
        name: Type.String({ description: '要删除的 MCP server name' }),
      }),
      execute: async (_toolCallId, params) => {
          const ok = await removeMcpServer(userId, params.name)
          return {
            content: [{
              type: 'text',
              text: ok ? `已删除 MCP server「${params.name}」。` : `未找到名为「${params.name}」的 MCP server。`,
            }],
            details: {},
          }
      },
    }),

    defineTool({
      name: 'render_preview',
      label: 'Render Preview',
      description: '在 Sir 的界面上打开一个预览面板，展示你生成的内容。' +
          '当你写了网页(html)、文档(markdown)、代码片段(code)、或图表(mermaid) 且内容较长值得独立预览时，调用此工具。' +
          '短代码（几行）不需要用这个，直接放回复里即可。',
      parameters: Type.Object({
        type: Type.Union([Type.Literal('html'), Type.Literal('markdown'), Type.Literal('code'), Type.Literal('mermaid')], { description: '内容类型' }),
        title: Type.String({ description: '预览面板标题，简短描述内容' }),
        content: Type.String({ description: '完整内容（HTML源码 / Markdown文本 / 代码 / Mermaid语法）' }),
        language: Type.Optional(Type.String({ description: '仅 type=code 时填，语言标识如 typescript、python' })),
      }),
      execute: async (_toolCallId, params) => {
          pendingArtifacts.set(userId, {
            type: params.type,
            title: params.title,
            content: params.content,
            language: params.language,
          })
          return {
            content: [{
              type: 'text',
              text: `已渲染预览「${params.title}」(${params.type})，Sir 可以在右侧面板查看。`,
            }],
            details: {},
          }
      },
    }),

    // ═══ 制品管理 ═══
    defineTool({
      name: 'search_artifacts',
      label: 'Search Artifacts',
      description: '搜索 Sir 的制品库。按标题/内容模糊匹配、类型筛选、时间范围。返回匹配列表供 Sir 选择。',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: '标题/内容关键词' })),
        type: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('markdown'), Type.Literal('code'), Type.Literal('mermaid')], { description: '按类型筛选' })),
        days: Type.Optional(Type.Number({ description: '只看最近 N 天内' })),
        limit: Type.Optional(Type.Number({ description: '返回条数上限,默认 10' })),
      }),
      execute: async (_toolCallId, params) => {
          const limit = Math.min(params.limit || 10, 20)
          const qs = new URLSearchParams()
          if (params.query) qs.set('q', params.query)
          if (params.type) qs.set('type', params.type)
          // The Java /api/artifacts list has no "recent N days" filter — over-fetch (up to the
          // server cap) and apply the days cutoff client-side, preserving the old tool behaviour.
          qs.set('limit', String(params.days ? 100 : limit))
          const { items } = await serverGet<{
            total: number
            items: Array<{ id: string; type: string; title: string; language?: string; version: number; createdAt: number }>
          }>(userId, `/api/artifacts?${qs.toString()}`)
          let rows = items
          if (params.days) {
            const cutoff = Date.now() - params.days * 86400000
            rows = rows.filter(r => r.createdAt >= cutoff).slice(0, limit)
          }
          if (rows.length === 0) return { content: [{ type: 'text', text: '未找到匹配的制品。' }], details: {} }
          const summary = rows.map(r => ({ id: r.id, type: r.type, title: r.title, language: r.language, version: r.version, createdAt: r.createdAt }))
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], details: {} }
      },
    }),

    defineTool({
      name: 'pin_artifact',
      label: 'Pin Artifact',
      description: '钉住一个制品到当前对话上下文。钉住后你能看到完整内容并可用 update_artifact 编辑。传 null 取消钉住。',
      parameters: Type.Object({
        artifactId: Type.Union([Type.String(), Type.Null()], { description: '制品 ID,传 null 取消钉住' }),
      }),
      execute: async (_toolCallId, params) => {
          if (!params.artifactId) {
            pinArtifact(userId, null)
            broadcast('artifact_pinned', JSON.stringify({ pinned: false }), userId)
            return { content: [{ type: 'text', text: '已取消钉住。' }], details: {} }
          }
          let a: ArtifactRow
          let content: string
          try {
            // v0.3: content comes from either the row (legacy) or a local file (uri).
            const fetched = await getArtifactContent(userId, params.artifactId)
            a = fetched.record
            content = fetched.content
          } catch (err) {
            if (isNotFound(err)) return { content: [{ type: 'text', text: '制品不存在或无权访问。' }], details: {} }
            throw err
          }
          pinArtifact(userId, params.artifactId)
          // Broadcast keeps the same shape the front-end already renders — always send
          // the materialised content string so ArtifactPanel doesn't need to re-fetch.
          broadcast('artifact_pinned', JSON.stringify({ pinned: true, id: a.id, type: a.type, title: a.title, content, language: a.language, version: a.version }), userId)
          return { content: [{ type: 'text', text: `已钉住「${a.title}」(v${a.version})，我能看到完整内容了。` }], details: {} }
      },
    }),

    defineTool({
      name: 'update_artifact',
      label: 'Update Artifact',
      description: '修改当前钉住的制品内容(原地更新,版本号+1)。必须先 pin 再改。',
      parameters: Type.Object({
        content: Type.String({ description: '替换后的完整内容' }),
        title: Type.Optional(Type.String({ description: '可选:同时更新标题' })),
      }),
      execute: async (_toolCallId, params) => {
          const pinnedId = getPinnedArtifactId(userId)
          if (!pinnedId) return { content: [{ type: 'text', text: '当前没有钉住的制品,请先 pin_artifact。' }], details: {} }
          const body = params.title ? { content: params.content, title: params.title } : { content: params.content }
          let updated: ArtifactRow | undefined
          try {
            updated = await serverPatch<ArtifactRow>(userId, `/api/artifact/${encodeURIComponent(pinnedId)}`, body)
          } catch (err) {
            if (!isNotFound(err)) throw err
          }
          if (updated) {
            // v0.3: PATCH echoes the refreshed row (now content=null + uri=file://). We
            // just wrote the new body (`params.content`) so no need to re-read from disk;
            // prefer that over an extra fs call for the SSE payload.
            const echoContent = params.content
            broadcast('artifact_updated', JSON.stringify({ id: updated.id, type: updated.type, title: updated.title, content: echoContent, language: updated.language, version: updated.version }), userId)
          }
          return { content: [{ type: 'text', text: `已更新「${updated?.title || ''}」→ v${updated?.version}，Sir 面板已刷新。` }], details: {} }
      },
    }),

    // ═══ 任务派发(agent 模式:Jarvis 在对话中直接调用)═══
    defineTool({
      name: 'create_task',
      label: 'Create Task',
      description: '把一个需要耗时或复杂执行的任务派给团队成员。你(Jarvis)自己能快速答的问题不要派任务,直接回答即可。' +
          '每个子任务必填 domain(稳定可复用的能力领域名,如"技术调研"/"差旅出行"/"jarvis开发",同类任务 domain 务必一致,系统靠它累积执行次数)。' +
          'assignee 优先填现有团队成员的 recipe ID(见上下文「可用团队成员」);没有合适的就填描述性角色名(通常与 domain 一致),系统会创建临时执行者。绝不填"通用"或"general"。' +
          'cwd 只在涉及具体仓库的开发类任务填(仓库绝对路径),调研/生活类不填。' +
          'skills 可选:从可用 skill 里挑出与该子任务相关的(如调研类挂 deep-research),小弟会加载对应方法论。' +
          'resumeSubtaskId 可选:若该任务与某历史子任务做过的事相关,填其 subtask id,小弟会带上那次的完整记忆(任务描述+思考+工具轨迹+沟通)继续干。通常不用填 —— 系统会按 assignee 自动匹配上次同类任务。',
      parameters: Type.Object({
        name: Type.String({ description: '任务名(简短)' }),
        description: Type.String({ description: '任务原始需求描述' }),
        subtasks: Type.Array(Type.Object({
          name: Type.String({ description: '子任务名' }),
          description: Type.String({ description: '这个子任务具体做什么' }),
          assignee: Type.String({ description: '执行者:团队成员 recipe ID 或描述性角色名' }),
          domain: Type.String({ description: '能力领域名(稳定可复用)' }),
          cwd: Type.Optional(Type.String({ description: '仅开发类任务填,仓库绝对路径' })),
          skills: Type.Optional(Type.Array(Type.String(), { description: '挂载的 skill 名列表(可选)' })),
          resumeSubtaskId: Type.Optional(Type.String({ description: '历史子任务 id(可选,通常留空由系统自动匹配)' })),
        }), { description: '子任务列表' }),
      }),
      execute: async (_toolCallId, params) => {
          const task = await createTask(userId, params.name, params.description)
          await updateTask(userId, task.id, { status: 'planning' })
          const { executeTaskInBackground } = await import('./action-dispatcher.js')
          executeTaskInBackground(userId, task.id, params.subtasks)
          const list = params.subtasks.map((st, i) => `  ${i + 1}. ${st.name}（${st.assignee}）`).join('\n')
          return { content: [{ type: 'text', text: `已创建任务「${params.name}」(${task.id})并派发执行:\n${list}\n有进展会通知 Sir。` }], details: {} }
      },
    }),

    defineTool({
      name: 'cancel_task',
      label: 'Cancel Task',
      description: '取消一个或全部进行中的任务。taskId 传具体 ID 取消单个,传 "all" 取消全部活跃任务。',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务 ID,或 "all" 取消全部' }),
        reason: Type.Optional(Type.String({ description: '取消原因(可选)' })),
      }),
      execute: async (_toolCallId, params) => {
          const { abortTask } = await import('./action-dispatcher.js')
          if (params.taskId === 'all') {
            const active = (await listTasks(userId)).filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
            for (const t of active) { await updateTask(userId, t.id, { status: 'cancelled' }); abortTask(t.id) }
            return { content: [{ type: 'text', text: `已取消全部 ${active.length} 个任务。${params.reason ? `原因:${params.reason}` : ''}` }], details: {} }
          }
          const task = await getTask(userId, params.taskId)
          if (!task) return { content: [{ type: 'text', text: '未找到该任务。' }], details: {} }
          await updateTask(userId, params.taskId, { status: 'cancelled' })
          abortTask(params.taskId)
          return { content: [{ type: 'text', text: `已取消任务「${task.name}」。` }], details: {} }
      },
    }),

    defineTool({
      name: 'send_message',
      label: 'Send Message',
      description: '给一个运行中的子任务(小弟)发消息,补充指令或纠正方向。只能对上下文里带 (subtaskId: xxx) 标记的运行中子任务操作。',
      parameters: Type.Object({
        subtaskId: Type.String({ description: '运行中子任务的 subtaskId' }),
        message: Type.String({ description: '要传达的内容' }),
      }),
      execute: async (_toolCallId, params) => {
          bus.notify(userId, 'jarvis', params.subtaskId, params.subtaskId, params.message)
          const online = bus.isRegistered(params.subtaskId)
          broadcast('progress', `💬 Jarvis → Agent: ${params.message.slice(0, 40)}`, userId)
          return { content: [{ type: 'text', text: online ? `已把消息发给小弟 (${params.subtaskId.slice(0, 6)})。` : `消息已记录(小弟当前不在线,下次恢复时可读)。` }], details: {} }
      },
    }),

    defineTool({
      name: 'interrupt_agent',
      label: 'Interrupt Agent',
      description: '打断一个运行中的子任务(小弟)。同样只能对带 (subtaskId: xxx) 标记的运行中子任务操作。',
      parameters: Type.Object({
        subtaskId: Type.String({ description: '运行中子任务的 subtaskId' }),
      }),
      execute: async (_toolCallId, params) => {
          const ok = await interruptAgent(params.subtaskId)
          return { content: [{ type: 'text', text: ok ? `已打断小弟 (${params.subtaskId.slice(0, 6)})。` : `打断失败,该小弟可能已结束。` }], details: {} }
      },
    }),
  ]
}

