import { homedir, userInfo } from 'os'
import { listRecipes } from '../team/registry.js'
import { bus } from '../a2a/bus.js'
import { searchMemory } from '../memory/everos.js'
import { consumeArtifact, type PendingArtifact } from './tools.js'
import { onMessageHandled } from './state.js'
import { getTaskSummary } from '../task/manager.js'
import { debug, withBrainLock, rawLlmCall, llmCall } from './llm.js'
import { addToBuffer, getRecentConversation, saveConversation, saveArtifact } from './conversation.js'
import { parseAction, dispatchAction } from './action-dispatcher.js'
import { getUserWorkspace } from '../shared/user-workspace.js'

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

export async function think(userId: string, userMessage: string, onProgress?: (text: string) => void, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<ThinkResult> {
  const t0 = Date.now()
  debug('think() called:', userMessage.slice(0, 50))

  const taskContext = await getTaskSummary(userId)
  if (signal?.aborted) throw new Error('aborted')

  const recipes = await listRecipes(userId)
  const teamInfo = recipes.map(r => `- ${r.name} (id: ${r.id}): ${r.description}`).join('\n')

  debug('searching memory...')
  onProgress?.('正在回忆相关信息...')
  const t1 = Date.now()
  const memories = await searchMemory(userId, userMessage, 5)
  console.log(`[perf] searchMemory: ${Date.now() - t1}ms`)
  debug('memory done, length:', memories.length)
  if (signal?.aborted) throw new Error('aborted')

  const recentConvo = await getRecentConversation(userId)
  if (signal?.aborted) throw new Error('aborted')

  const runtimeEnv = `## 运行环境(代码注入,可信)
当前系统用户名: ${userInfo().username}
HOME 目录: ${homedir()}
小弟默认工作区(临时产物落这): ${getUserWorkspace(userId)}

**cwd 字段填写规则(严格):**
- 只填**你确认存在**的绝对路径——最近对话里 Sir 明确说过的、或以上 HOME 目录下你亲眼见过的
- **不要凭想象编用户名或路径**——尤其别自己"简写"HOME 里的用户名
- 没把握就**留空**(小弟会去用户工作区跑,永远安全)`

  const contextualPrompt = `${runtimeEnv}

## 当前任务状态
${taskContext}

## 可用团队成员
${teamInfo || '暂无团队成员'}

${memories ? `## 关于 Sir 的记忆\n${memories}\n` : ''}
## 本次会话对话记录
${recentConvo || '(刚开始对话)'}

## Sir 最新消息
${userMessage}`

  onProgress?.('正在分析你的需求...')
  const t2 = Date.now()
  console.log(`[perf] prompt built, length: ${contextualPrompt.length} chars`)
  let accum = ''
  let codeBlockHit = false
  const filteredDelta = onDelta ? (text: string) => {
    if (codeBlockHit) return
    accum += text
    if (accum.includes('```')) {
      codeBlockHit = true
      return
    }
    onDelta(text)
  } : undefined
  let ac: AbortController | undefined
  if (signal) {
    ac = new AbortController()
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac!.abort(), { once: true })
  }
  const llmResponse = await llmCall(userId, contextualPrompt, filteredDelta, ac)
  console.log(`[perf] llmCall: ${Date.now() - t2}ms`)
  console.log(`[perf] total think(): ${Date.now() - t0}ms`)

  const action = parseAction(llmResponse)

  if (!action) {
    const cleaned = llmResponse.replace(/```(?:json)?[\s\S]*?```/g, '').trim()
    const finalResponse = cleaned || llmResponse
    const noActionArtifact = consumeArtifact(userId)
    const artifactId = noActionArtifact ? await saveArtifact(userId, noActionArtifact) : undefined
    await addToBuffer(userId, 'jarvis', finalResponse, artifactId)
    await saveConversation(userId, userMessage, finalResponse)
    return { response: finalResponse, artifact: noActionArtifact || undefined }
  }

  const { response, artifact } = await dispatchAction(userId, action, llmResponse, userMessage)
  await saveConversation(userId, userMessage, response)
  return { response, artifact }
}
