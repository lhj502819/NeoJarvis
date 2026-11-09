import type { ChatImage } from './types.js'
import { getSettings } from '../jarvis/persona.js'

/**
 * Agent 运行时中立接口(P6 双运行时:Pi ↔ Claude Agent SDK)。
 *
 * 动机:Pi 进程内轻、可控;Claude SDK 的 agent 能力强(长程任务/工具编排)。
 * 两者都接 Anthropic 兼容网关(japi),凭证同源(~/.claude/settings.json + .env)。
 *
 * 中立契约:
 *   - 工具:RuntimeTool(JSON Schema + execute),各运行时自行转换
 *     (Pi → defineTool/TypeBox;Claude → createSdkMcpServer/Zod)
 *   - 事件:onDelta(正文流)/ onEvent('thinking_delta'|'delta'|'tool_start'|'tool_end', payload)
 *     —— 与 llm.ts 现有事件语义对齐,前端零改动
 *   - 结果:response + toolCalls(工具轨迹,供 jarvis_tool_traces/流水)
 *
 * 选择:persona settings.runtime → env JARVIS_RUNTIME → 默认 'pi'。
 * Phase B:小弟会话(dispatchToAgent)同样走本接口(Claude 侧用 resume 语义)。
 */

export type RuntimeId = 'pi' | 'claude'

export interface RuntimeTool {
  name: string
  description: string
  /** JSON Schema(与 TypeBox 兼容的子集;TypeBox 的 parameters 本身就是 JSON Schema) */
  jsonSchema: Record<string, unknown>
  execute(args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>
}

export interface RuntimeTurnOpts {
  userId: string
  systemPrompt: string
  prompt: string
  tools: RuntimeTool[]
  signal?: AbortSignal
  images?: ChatImage[]
  cwd?: string
  onDelta?(text: string): void
  onEvent?(type: string, content: string): void
}

export interface RuntimeToolCall {
  toolName: string
  args: unknown
  isError?: boolean
}

export interface RuntimeTurnResult {
  response: string
  toolCalls: RuntimeToolCall[]
  costMs: number
  sessionId?: string
}

/** Pi ToolDefinition → 中立 RuntimeTool(execute 摊平 content 为文本)。 */
export function piToolDefToRuntime(def: {
  name: string
  description: string
  parameters?: unknown
  execute: (...a: any[]) => Promise<any>
}): RuntimeTool {
  return {
    name: def.name,
    description: def.description,
    jsonSchema: (def.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    execute: async (args: Record<string, unknown>) => {
      const r = await def.execute(`rt-${Date.now()}`, args ?? {})
      const text = Array.isArray(r?.content)
        ? r.content.map((c: any) => c?.text ?? '').join('\n')
        : String(r ?? '')
      return { text }
    },
  }
}

export function getRuntimeId(): RuntimeId {
  const fromEnv = process.env.JARVIS_RUNTIME
  if (fromEnv === 'claude' || fromEnv === 'pi') return fromEnv
  const s = getSettings() as { runtime?: string }
  if (s?.runtime === 'claude') return 'claude'
  return 'pi'
}
