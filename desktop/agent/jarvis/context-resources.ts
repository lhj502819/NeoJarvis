import { serverGet } from '../shared/server-client.js'
import { getTaskDetail } from '../task/manager.js'
import { getArtifactContent } from '../shared/artifact-content.js'
import { getTimeline } from './timeline-store.js'
import { redactSecrets } from '../shared/redact.js'

/**
 * 读资源表(superagent-v2 P1,docs/superagent-design-v2.md):
 * Inline & Spill 的"Spill"半边 —— 上下文里只注入卡片(预览+长度+读指针),
 * 全文一律经 read_context 工具按指针展开。
 *
 * 纪律(借 dsh-superagent-prototype):
 *   - 卡片上出现的每个 ID 必须能经本表读出,模型才能沿引用一跳一跳走
 *   - 分页上限:列表默认 20/最多 50;文本默认 4000/最多 8000 字符
 *   - 小弟视角只能读自己任务相关对象,其余一律拒绝(dsh 的 redact 语义)
 */

export const PREVIEW_MAX = 160
export const LIST_PAGE_DEFAULT = 20
export const LIST_PAGE_MAX = 50
export const TEXT_PAGE_DEFAULT = 4000
export const TEXT_PAGE_MAX = 8000

/** 折叠空白后截取前 max 字符 —— 卡片预览的唯一实现,预算单测盯它。 */
export function preview(text: string, max = PREVIEW_MAX): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 给工具描述用的资源语法(模型靠它知道能读什么)。 */
export const RESOURCE_GRAMMAR = [
  'tasks: 活动任务卡片列表(分页)',
  'task/<taskId>: 任务详情(含子任务/轮次/沟通)',
  'message/<messageId>: 对话消息全文',
  'conversation: 对话消息卡片列表(分页,更早消息从这里找)',
  'skills: 可挂载技能的完整目录(含完整描述,分页)',
  'artifact/<artifactId>: 制品全文(长文分页)',
  'trace/<traceId>: 工具调用轨迹详情',
  'timeline/<messageId>: 该条回复的思考/工具时间线',
].join('\n')

export type ReadScope = { role: 'jarvis' } | { role: 'worker'; taskId: string }

interface PageOpts {
  offset: number
  limit?: number
}

/** 文本分页:默认 4000/上限 8000 字符;截断时附续读提示(模型看到才知道还有下文)。 */
export function textPage(resource: string, body: string, opts: PageOpts): string {
  const limit = Math.min(opts.limit ?? TEXT_PAGE_DEFAULT, TEXT_PAGE_MAX)
  const total = body.length
  const slice = body.slice(opts.offset, opts.offset + limit)
  const end = opts.offset + slice.length
  const head = opts.offset > 0 ? `(从第 ${opts.offset} 字符继续,全文 ${total} 字)\n` : ''
  const tail = end < total ? `\n…[已截断,全文 ${total} 字;续读 ${resource} offset=${end}]` : ''
  return `${head}${slice}${tail}`
}

/** 列表分页:默认 20/上限 50 条,返回 {items, next_offset}(dsh 语义)。 */
export function listPage<T>(items: T[], opts: PageOpts): { items: T[]; next_offset: number | null } {
  const size = Math.min(opts.limit ?? LIST_PAGE_DEFAULT, LIST_PAGE_MAX)
  const page = items.slice(opts.offset, opts.offset + size)
  return { items: page, next_offset: opts.offset + size < items.length ? opts.offset + size : null }
}

/** 任务卡片:预览 + 全文长度 + 读指针,三元组齐全。 */
export function taskCard(t: { id: string; name: string; status: string; description?: string }): string {
  const desc = t.description ?? ''
  return `task/${t.id} ${t.name} · ${t.status} · ${preview(desc) || '(无描述)'} · 全文${desc.length}字`
}

/** 消息 stub(对话历史的降级注入形态)。 */
export function messageStub(m: { id: number; role: string; content: string }): string {
  return `message/${m.id} ${m.role === 'user' ? 'Sir' : 'Jarvis'}: ${preview(m.content, 50)} (${m.content.length}字)`
}

const jsonPage = (resource: string, data: unknown, opts: PageOpts) =>
  textPage(resource, JSON.stringify(data, null, 1), opts)

/**
 * 读一个资源。抛 Error(带中文原因)即拒绝 —— 调用方(工具层)直接把消息回给模型。
 */
export async function readResource(userId: string, resource: string, opts: PageOpts, scope: ReadScope): Promise<string> {
  const isWorker = scope.role === 'worker'
  // 显式注解变量类型,让 TS 控制流把 refuse(...) 识别为终结点(never)
  const refuse: (why: string) => never = (why) => { throw new Error(`read_context 拒绝: ${why}`) }

  // ── task/<id>[可选将来扩展子路径] ──
  if (resource.startsWith('task/')) {
    const taskId = resource.slice('task/'.length)
    if (isWorker && taskId !== scope.taskId) refuse(`小弟只能读自己绑定的任务 ${scope.taskId}`)
    const detail = await getTaskDetail(userId, taskId)
    if (!detail) refuse(`任务 ${taskId} 不存在`)
    return jsonPage(resource, detail, opts)
  }

  // ── tasks(活动任务卡片) ──
  if (resource === 'tasks') {
    if (isWorker) refuse('任务列表仅 Jarvis 可读')
    const { tasks } = await serverGet<{ summary: string; tasks: Array<{ id: string; name: string; status: string; description?: string }> }>(userId, '/api/tasks')
    const active = tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status))
    const page = listPage(active, opts)
    return `${JSON.stringify({ ...page, items: page.items.map(taskCard) }, null, 1)}`
  }

  // ── message/<id> ──
  if (resource.startsWith('message/')) {
    if (isWorker) refuse('对话消息仅 Jarvis 可读(小弟的输入由系统投递)')
    const id = Number(resource.slice('message/'.length))
    if (!Number.isFinite(id)) refuse(`无效消息 id: ${resource}`)
    const turns = await serverGet<Array<{ id: number; role: string; content: string }>>(userId, '/api/conversation')
    const hit = turns.find(t => t.id === id)
    if (!hit) refuse(`消息 ${id} 不存在`)
    return textPage(resource, redactSecrets(hit.content), opts)
  }

  // ── conversation(消息 stub 分页) ──
  if (resource === 'conversation') {
    if (isWorker) refuse('对话仅 Jarvis 可读')
    const turns = await serverGet<Array<{ id: number; role: string; content: string }>>(userId, '/api/conversation')
    const page = listPage(turns, opts)
    return `${JSON.stringify({ ...page, items: page.items.map(messageStub) }, null, 1)}`
  }

  // ── skills(完整技能目录,prompt 里只放截断版) ──
  if (resource === 'skills') {
    if (isWorker) refuse('技能目录仅 Jarvis 可读')
    const { listSkillsForUser } = await import('./skill-prefs.js')
    const list = await listSkillsForUser(userId)
    const page = listPage(list.filter(s => s.enabled), opts)
    return `${JSON.stringify({ ...page, items: page.items.map(s => ({ name: s.name, description: s.description })) }, null, 1)}`
  }

  // ── artifact/<id>(两端可读:制品是共享库) ──
  if (resource.startsWith('artifact/')) {
    const id = resource.slice('artifact/'.length)
    try {
      const { record, content } = await getArtifactContent(userId, id)
      const head = `# ${record.title} · ${record.type}${record.language ? ` (${record.language})` : ''} · v${record.version}\n`
      return head + textPage(resource, content, opts)
    } catch (err) {
      if (err instanceof Error && / -> 404\b/.test(err.message)) refuse(`制品 ${id} 不存在`)
      throw err
    }
  }

  // ── trace/<id>(工具调用轨迹) ──
  if (resource.startsWith('trace/')) {
    if (isWorker) refuse('工具轨迹仅 Jarvis 可读')
    const id = resource.slice('trace/'.length)
    try {
      const row = await serverGet<{ toolName: string; args: string; resultText: string | null; isError: boolean }>(userId, `/api/tool-traces/${encodeURIComponent(id)}`)
      const body = `tool: ${row.toolName}\nisError: ${row.isError}\nargs: ${preview(row.args ?? '', 1000)}\nresult: ${preview(row.resultText ?? '', 2000)}`
      return textPage(resource, body, opts)
    } catch (err) {
      if (err instanceof Error && / -> 404\b/.test(err.message)) refuse(`轨迹 ${id} 不存在`)
      throw err
    }
  }

  // ── timeline/<messageId> ──
  if (resource.startsWith('timeline/')) {
    if (isWorker) refuse('时间线仅 Jarvis 可读')
    const messageId = Number(resource.slice('timeline/'.length))
    if (!Number.isFinite(messageId)) refuse(`无效消息 id: ${resource}`)
    const tl = await getTimeline(userId, messageId)
    if (!tl.length) refuse(`消息 ${messageId} 无时间线`)
    return jsonPage(resource, tl, opts)
  }

  refuse(`未知资源: ${resource}(可用语法见工具描述)`)
}
