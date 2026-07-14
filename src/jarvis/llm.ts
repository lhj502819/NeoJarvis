import { query, type McpServerConfig, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildSystemPrompt } from './prompt.js'
import type { ChatImage } from '../shared/types.js'

const JARVIS_PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'plugins', 'jarvis')
const SKILLS_HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'plugins', 'skills-hub')
import { createJarvisTools } from './tools.js'
import { broadcast } from './sse.js'
import { buildUserEnv } from '../shared/user-env.js'
import { getUserWorkspace } from '../shared/user-workspace.js'
import { buildUserMcpServers } from '../shared/user-mcp.js'
import { getEnabledHubSkills, PIPELINE_SKILLS } from './skill-prefs.js'

const CLAUDE_PATH = execSync('which claude', { encoding: 'utf-8' }).trim()

const DEBUG = process.env.JARVIS_DEBUG === '1' || process.argv.includes('--debug')

export function debug(...args: any[]) {
  if (DEBUG) console.log('\x1b[2m[debug]\x1b[0m', ...args)
}

const brainLocks = new Map<string, Promise<void>>()

export function withBrainLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = brainLocks.get(userId) || Promise.resolve()
  let resolve: () => void
  brainLocks.set(userId, new Promise(r => { resolve = r }))
  return prev.then(fn).finally(() => resolve!())
}

export async function llmCall(userId: string, prompt: string, onDelta?: (text: string) => void, abortController?: AbortController, images?: ChatImage[]): Promise<string> {
  const systemPrompt = await buildSystemPrompt(userId)
  const mcpServers: Record<string, McpServerConfig> = {
    'jarvis-system': createJarvisTools(userId),
    ...(await buildUserMcpServers(userId)),
  }
  return rawLlmCall(userId, systemPrompt, prompt, onDelta, mcpServers, abortController, images)
}

// 有图片时,把纯文本 prompt 换成一条带 image content block 的 SDKUserMessage。
// SDK 的 query prompt 支持 string | AsyncIterable<SDKUserMessage>;吐一条后 generator
// 结束 → stdin EOF → SDK 处理这一轮并返回 result。
function buildImagePrompt(text: string, images: ChatImage[]): AsyncIterable<SDKUserMessage> {
  return (async function* () {
    yield {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map(img => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType as any, data: img.data },
          })),
        ],
      },
    } as SDKUserMessage
  })()
}

export async function rawLlmCall(userId: string, systemPrompt: string, prompt: string, onDelta?: (text: string) => void, mcpServers?: Record<string, McpServerConfig>, abortController?: AbortController, images?: ChatImage[]): Promise<string> {
  const t0 = Date.now()
  debug('rawLlmCall start, prompt length:', prompt.length, images?.length ? `+${images.length} images` : '')
  console.log(`[perf] rawLlmCall start, system prompt: ${systemPrompt.length} chars, user prompt: ${prompt.length} chars`)
  const promptInput = images && images.length > 0 ? buildImagePrompt(prompt, images) : prompt
  const enabledSkills = [...PIPELINE_SKILLS, ...(await getEnabledHubSkills(userId))]
  let finalResult = ''
  let firstTokenTime = 0
  for await (const message of query({
    prompt: promptInput,
    options: {
      systemPrompt,
      pathToClaudeCodeExecutable: CLAUDE_PATH,
      cwd: getUserWorkspace(userId),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      plugins: [{ type: 'local', path: JARVIS_PLUGIN_DIR }, { type: 'local', path: SKILLS_HUB_DIR }],
      skills: enabledSkills,
      env: await buildUserEnv(userId),
      maxTurns: 99999,
      includePartialMessages: true,
      ...(mcpServers && { mcpServers }),
      ...(abortController && { abortController }),
    },
  })) {
    if (message.type === 'stream_event') {
      const evt = (message as any).event
      if (evt?.type === 'content_block_start' && evt.content_block?.type === 'thinking') {
        debug('extended thinking block started')
      }
      if (evt?.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
        if (!firstTokenTime) {
          firstTokenTime = Date.now()
          console.log(`[perf] first thinking token: ${firstTokenTime - t0}ms`)
        }
      }
      if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now()
          console.log(`[perf] first token: ${firstTokenTime - t0}ms`)
        }
        onDelta?.(evt.delta.text)
      }
      continue
    }

    debug('msg:', message.type, (message as any).subtype || '', (message as any).message?.content?.map((b: any) => b.type).join(',') || '')
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if ('type' in block && block.type === 'tool_use') {
          const toolName = (block as any).name || 'tool'
          debug('tool_use:', toolName)
          broadcast('progress', `🔧 Jarvis 正在使用 ${toolName}...`, userId)
        }
      }
    }
    if (message.type === 'result') {
      debug('result:', (message as any).subtype, 'text length:', finalResult.length)
      if (message.subtype === 'success') {
        finalResult = message.result
      } else {
        const err = (message as any).errors?.join('; ') || (message as any).subtype
        debug('result ERROR:', err)
        finalResult = `[错误] ${err}`
      }
    }
  }
  debug('rawLlmCall done, result length:', finalResult.length)
  console.log(`[perf] rawLlmCall done: ${Date.now() - t0}ms total, result: ${finalResult.length} chars`)
  return finalResult
}
