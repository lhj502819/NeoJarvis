import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { RuntimeTool, RuntimeTurnOpts, RuntimeTurnResult, RuntimeToolCall } from '../shared/agent-runtime.js'

/**
 * Claude Agent SDK 运行时(P6 双运行时)。
 *
 * - 自定义工具:RuntimeTool[] → createSdkMcpServer(JSON Schema → Zod 子集转换)
 *   —— SDK 内部完成 tool_use/tool_result 往返,我们从消息流采集轨迹
 * - 事件映射:stream_event(content_block_delta) → thinking_delta / delta;
 *   assistant(tool_use) → tool_start;user(tool_result) → tool_end
 * - 终点:result 消息(subtype success / is_error)携带最终文本
 * - 隔离:settingSources=[] 不读用户 ~/.claude 配置;凭证走 env(网关同源)
 * - v1 限制:images 忽略(Claude SDK 图片入参结构不同,需要时单独接)
 */

interface SdkMessage {
  type: string
  subtype?: string
  session_id?: string
  event?: any
  message?: { content?: any[]; role?: string }
  result?: string
  is_error?: boolean
  duration_ms?: number
  error?: string
}

/** JSON Schema(顶层对象)→ Zod shape。只覆盖 jarvis 工具用到的子集,未知类型 z.any()。 */
function jsonSchemaToZodShape(schema: Record<string, unknown> | undefined): Record<string, any> {
  const shape: Record<string, any> = {}
  const props = (schema?.properties ?? {}) as Record<string, any>
  const required = new Set<string>((schema?.required ?? []) as string[])
  for (const [key, def] of Object.entries(props)) {
    let zt: any
    switch (def?.type) {
      case 'string':
        zt = def.enum ? z.enum(def.enum as [string, ...string[]]) : z.string()
        break
      case 'number':
      case 'integer':
        zt = z.number()
        break
      case 'boolean':
        zt = z.boolean()
        break
      case 'array':
        zt = z.array(z.any())
        break
      default:
        zt = z.any()
    }
    if (def?.description) zt = zt.describe(String(def.description))
    shape[key] = required.has(key) ? zt : zt.optional()
  }
  return shape
}

export async function claudeRunTurn(
  userId: string,
  systemPrompt: string,
  prompt: string,
  tools: RuntimeTool[],
  opts: RuntimeTurnOpts,
): Promise<RuntimeTurnResult> {
  const t0 = Date.now()
  // RuntimeTool → SDK MCP server(tool_use/tool_result 由 SDK 内部往返)
  const zodShapes: Record<string, any> = {}
  const handlers: Record<string, any> = {}
  for (const rt of tools) {
    const shape = jsonSchemaToZodShape(rt.jsonSchema)
    zodShapes[rt.name] = shape
    handlers[rt.name] = async (args: Record<string, unknown>) => {
      try {
        const r = await rt.execute(args ?? {})
        return { content: [{ type: 'text' as const, text: r.text || '(空结果)' }], isError: !!r.isError }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `工具执行失败:${err instanceof Error ? err.message : String(err)}` }], isError: true }
      }
    }
  }
  const sdkServer = tools.length > 0
    ? createSdkMcpServer({ name: 'jarvis-tools', version: '1.0.0', tools: tools.map(rt => tool(rt.name, rt.description, zodShapes[rt.name] ?? {}, handlers[rt.name])) })
    : undefined

  const abortController = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort()
    else opts.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  const model = process.env.JARVIS_LLM_MODEL || 'sonnet'
  if (opts.images?.length) {
    console.log(`[runtime:claude] 忽略 ${opts.images.length} 张图片(Claude 运行时图片入参待接)`)
  }

  const messageStream = query({
    prompt,
    options: {
      systemPrompt,                        // 完整接管系统提示词(人设/纪律/上下文都在这)
      settingSources: [],                  // 隔离:不读用户 ~/.claude 配置
      model,
      cwd: opts.cwd,
      ...(sdkServer ? { mcpServers: { 'jarvis-tools': sdkServer } } : {}),
      maxTurns: 40,
      permissionMode: 'bypassPermissions',
      includePartialMessages: true,        // stream_event(thinking/text delta)
      abortController,
    },
  })

  let response = ''
  let isError = false
  const toolCalls: RuntimeToolCall[] = []
  const openCalls = new Map<string, string>()   // tool_use id → name

  for await (const message of messageStream as AsyncIterable<SdkMessage>) {
    if (message.type === 'stream_event') {
      const ev = message.event ?? {}
      if (ev.type === 'content_block_delta') {
        const d = ev.delta ?? {}
        if (d.type === 'thinking_delta' && d.thinking) opts.onEvent?.('thinking_delta', d.thinking)
        if (d.type === 'text_delta' && d.text) {
          opts.onDelta?.(d.text)
          opts.onEvent?.('delta', d.text)
        }
      }
      continue
    }
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'tool_use') {
          openCalls.set(block.id, block.name)
          toolCalls.push({ toolName: block.name, args: block.input })
          opts.onEvent?.('tool_start', JSON.stringify({ name: block.name, args: JSON.stringify(block.input ?? {}).slice(0, 600) }))
        }
      }
      continue
    }
    if (message.type === 'user') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'tool_result') {
          const name = openCalls.get(block.tool_use_id) ?? 'unknown'
          openCalls.delete(block.tool_use_id)
          const err = !!block.is_error
          const call = toolCalls.find(c => c.toolName === name && c.isError === undefined)
          if (call) call.isError = err
          opts.onEvent?.('tool_end', JSON.stringify({ name, isError: err }))
        }
      }
      continue
    }
    if (message.type === 'result') {
      response = String(message.result ?? '')
      isError = !!message.is_error
      if (message.error && !response) response = message.error
      break
    }
  }

  if (isError && !response) throw new Error(`Claude 运行时返回错误:${response || '(无详情)'}`)
  void userId
  return { response, toolCalls, costMs: Date.now() - t0 }
}
