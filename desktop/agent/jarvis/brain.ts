import { homedir, userInfo } from 'os'
import { listRecipes } from '../team/registry.js'
import { listAdhocAgents } from '../a2a/adhoc.js'
import { bus } from '../a2a/bus.js'
import { searchMemory } from '../memory/everos.js'
import { consumeArtifact, type PendingArtifact } from './tools.js'
import { onMessageHandled } from './state.js'
import { getTaskSummary } from '../task/manager.js'
import { debug, withBrainLock, rawLlmCall, llmCall } from './llm.js'
import { addToBuffer, getRecentConversation, saveConversation, saveArtifact } from './conversation.js'
import { parseAction } from './action-dispatcher.js'
import { getUserWorkspace } from '../shared/user-workspace.js'
import { getPinnedArtifactId } from './orchestrator.js'
import { getArtifactContent } from '../shared/artifact-content.js'
import type { ChatImage } from '../shared/types.js'
import { listSkillsForUser } from './skill-prefs.js'
import { recordToolTrace, type ToolTraceInput } from '../shared/tool-trace.js'
import { getRecentJarvisToolTraces, formatToolTracesForPrompt } from './tool-trace-context.js'

export { parseAction } from './action-dispatcher.js'
export { addToBuffer } from './conversation.js'
export { abortTask } from './action-dispatcher.js'

bus.register('jarvis', 'Jarvis', async (msg) => {
  const question = msg.parts.find(p => p.kind === 'text')?.text || ''
  if (!question) return null

  const reply = await withBrainLock('system', () => rawLlmCall(
    'system',
    `你是 Jarvis。你的一个小弟在执行任务时遇到问题向你请示。请直接给出简短的决策或回答，不要输出 JSON。`,
    `小弟的问题：${question}`
  ))

  return {
    id: `reply-${Date.now()}`,
    from: 'jarvis',
    to: msg.from,
    contextId: msg.contextId,
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: reply || '继续执行，自行判断。' }],
    timestamp: new Date().toISOString(),
  }
})

export interface ThinkResult {
  response: string
  artifact?: PendingArtifact
}

export async function think(userId: string, userMessage: string, onProgress?: (text: string) => void, onDelta?: (text: string) => void, signal?: AbortSignal, images?: ChatImage[]): Promise<ThinkResult> {
  const t0 = Date.now()
  debug('think() called:', userMessage.slice(0, 50), images?.length ? `+${images.length}img` : '')

  const taskContext = await getTaskSummary(userId)
  if (signal?.aborted) throw new Error('aborted')

  const recipes = await listRecipes(userId)
  const teamInfo = recipes.map(r => `- ${r.name} (id: ${r.id}): ${r.description}`).join('\n')

  // 待转正候选:临时工累计 ≥3 次(与 get_team_stats 的 readyToPromote 同阈值)。
  // 把信号主动喂进 prompt,Jarvis 不必先调 get_team_stats 才发现——它会按 promote-agent
  // skill 在合适时机(汇报后/被问起时)顺口推荐。拉不到就降级空串,绝不阻塞。
  const promoteHint = await listAdhocAgents(userId)
    .then(adhocs => adhocs.filter(a => a.taskCount >= 3)
      .map(a => `- 「${a.domain}」临时工已干 ${a.taskCount} 次,达转正线,可考虑推荐 Sir 收编(promote-agent)`)
      .join('\n'))
    .catch(() => '')

  const availableSkills = await listSkillsForUser(userId)
  const enabledSkillLines = availableSkills
    .filter(s => s.enabled)
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n')

  debug('searching memory...')
  onProgress?.('正在回忆相关信息...')
  const t1 = Date.now()
  const memories = await searchMemory(userId, userMessage, 5)
  console.log(`[perf] searchMemory: ${Date.now() - t1}ms`)
  debug('memory done, length:', memories.length)
  if (signal?.aborted) throw new Error('aborted')

  const recentConvo = await getRecentConversation(userId)
  if (signal?.aborted) throw new Error('aborted')

  // 拉 Jarvis 自己最近几轮的工具调用轨迹(create_task 拿到的 task_id 等),注入 prompt
  // 让下一轮能看到"我上一步调了什么、返回了什么"。失败降级到空段落,不阻塞 think。
  const toolTraceItems = await getRecentJarvisToolTraces(userId, 10)
  if (signal?.aborted) throw new Error('aborted')
  const toolTraceSection = formatToolTracesForPrompt(toolTraceItems)

  // Pinned artifact context
  let pinnedContext = ''
  const pinnedId = getPinnedArtifactId(userId)
  if (pinnedId) {
    // v0.3: getArtifactContent handles both storage shapes (legacy content column vs.
    // new file uri) — the LLM prompt only ever sees the materialised text.
    let a: { id: string; type: string; title: string; language?: string; version: number } | undefined
    let content: string | undefined
    try {
      const fetched = await getArtifactContent(userId, pinnedId)
      a = fetched.record
      content = fetched.content
    } catch (err) {
      // Missing pinned artifact (deleted since pinning) -> skip; rethrow real server errors.
      if (!(err instanceof Error && / -> 404\b/.test(err.message))) throw err
      a = undefined
    }
    if (a && content !== undefined) {
      const LIMIT = 40000
      const truncated = content.length > LIMIT
        ? content.slice(0, LIMIT) + `\n\n[...内容过长已截断, 完整 ${content.length} 字符。若需修改被截断部分,先说明,我会分段处理]`
        : content
      pinnedContext = `## 当前钉住的制品(完整内容如下,你能直接看到)\nID: ${a.id} | 标题: ${a.title} | 类型: ${a.type}${a.language ? ` (${a.language})` : ''} | 版本: v${a.version}\n---\n${truncated}\n---\n**这就是完整制品内容,不要再去别处捞。** 用户接下来大概率要改它——直接用 update_artifact 传入修改后的完整内容即可(整篇替换,不是 diff)。\n`
    }
  }

  const runtimeEnv = `## 运行环境(代码注入,可信)
当前系统用户名: ${userInfo().username}
HOME 目录: ${homedir()}
小弟默认工作区(临时产物落这): ${getUserWorkspace(userId)}

**cwd 字段填写规则(严格):**
- 只填**你确认存在**的绝对路径——最近对话里 Sir 明确说过的、或以上 HOME 目录下你亲眼见过的
- **不要凭想象编用户名或路径**——尤其别自己"简写"HOME 里的用户名
- 没把握就**留空**(小弟会去用户工作区跑,永远安全)`

  const contextualPrompt = `${runtimeEnv}

${pinnedContext}## 当前任务状态
${taskContext}

## 可用团队成员
${teamInfo || '暂无团队成员'}
${promoteHint ? `\n### ⚠️ 待转正候选(临时工已达转正线)\n${promoteHint}\n` : ''}

## 可用技能(派任务时可挂给小弟)
${enabledSkillLines || '(暂无已启用技能)'}

${memories ? `## 关于 Sir 的记忆\n${memories}\n` : ''}
## 本次会话对话记录
${recentConvo || '(刚开始对话)'}

${toolTraceSection}

## Sir 最新消息
${userMessage}`

  onProgress?.('正在分析你的需求...')
  const t2 = Date.now()
  console.log(`[perf] prompt built, length: ${contextualPrompt.length} chars`)
  let ac: AbortController | undefined
  if (signal) {
    ac = new AbortController()
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac!.abort(), { once: true })
  }
  // agent 模式:LLM 在 loop 内自主调工具(create_task 等),文字实时流式给前端。
  // rawLlmCall 跑完整 agent loop 并返回最终文字,不再需要 parseAction/dispatchAction。
  // toolTraces 收集本次调用里所有 tool_use/tool_result 配对(不含 messageId),稍后回填
  const toolTraces: Array<Omit<ToolTraceInput, 'scope' | 'messageId'>> = []
  const llmResponse = await llmCall(userId, contextualPrompt, onDelta, ac, images, toolTraces)
  console.log(`[perf] llmCall: ${Date.now() - t2}ms`)
  console.log(`[perf] total think(): ${Date.now() - t0}ms`)

  const finalResponse = llmResponse
  const artifact = consumeArtifact(userId)
  const artifactId = artifact ? await saveArtifact(userId, artifact) : undefined
  const messageId = await addToBuffer(userId, 'jarvis', finalResponse, artifactId)
  // 拿到 messageId 后回填 traces 的归属并逐条 POST(失败不阻塞主流程,内部 catch)
  for (const t of toolTraces) {
    recordToolTrace(userId, { ...t, scope: 'jarvis', messageId })
  }
  await saveConversation(userId, userMessage, finalResponse)
  return { response: finalResponse, artifact: artifact || undefined }
}
