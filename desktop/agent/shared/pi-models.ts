/**
 * Pi SDK 模型运行时装配(从用户的 Claude CLI 配置桥接凭证)。
 *
 * 背景:旧 Claude SDK 直接 spawn claude CLI,凭证/代理/baseUrl 都由 ~/.claude/settings.json
 * 的 env 提供(ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_DEFAULT_*_MODEL)。
 * Pi SDK 在进程内调用 LLM,不读这些 env(Pi 的 anthropic provider 写死 baseUrl=api.anthropic.com,
 * 也不认 ANTHROPIC_DEFAULT_*_MODEL 模型映射)。
 *
 * 方案:读 ~/.claude/settings.json,把用户的代理配置翻译成 Pi 的自定义 provider
 * (models.json 格式),生成 jarvis 专用临时文件,再 ModelRuntime.create({ modelsPath })。
 * 这样用户的 claude CLI 用什么代理,jarvis 的 Pi SDK 就走什么代理。
 *
 * 本地覆盖:仓库根 .env(已 gitignore)里的 JARVIS_LLM_* 优先于 claude CLI 配置,
 * 让 jarvis 走独立网关/凭证/模型而不影响用户 claude CLI 的全局设置:
 *   JARVIS_LLM_BASE_URL — 网关地址(如 http://japi-ai-proxy.jd.com/aiProxy)
 *   JARVIS_LLM_TOKEN    — 网关凭证(作为 Authorization: Bearer 发送)
 *   JARVIS_LLM_MODEL    — 模型 id(Jarvis 本体与所有小弟统一用它,别名全部路由到它)
 *
 * 凭证安全:生成的 models.json 放 ~/.pi/agent/ 下(0600),与 Pi 自身的 auth.json 同级;
 * redactSecrets() 喂 LLM 上下文时仍会过滤 token(见 shared/redact.ts)。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

/** jarvis 在用户 Pi 配置目录下的桥接 provider 文件 */
const BRIDGE_MODELS_PATH = join(homedir(), '.pi', 'agent', 'jarvis-models.json')

/** 桥接 provider 的固定 id(llm.ts / client.ts / factory.ts 用它选模型) */
export const JARVIS_PROVIDER_ID = 'jarvis-claude-bridge'

interface ClaudeSettings {
  env?: Record<string, string>
  model?: string
  [k: string]: unknown
}

function readClaudeSettings(): ClaudeSettings {
  const p = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * Claude CLI 的 model 别名(sonnet/opus/haiku)映射到 Pi 的 model id。
 * 用户的 ANTHROPIC_DEFAULT_SONNET_MODEL 等 env 可能是代理自定义名
 * (如 "Claude-Sonnet-5-joyboost"),但 Pi 侧我们用标准 id 发请求,
 * 由代理自行映射(代理收 claude-sonnet-4-5 也能路由,见 DongCC 代理行为)。
 */
const MODEL_ALIAS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-5',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5',
  default: 'claude-sonnet-4-5',
}

/**
 * 读仓库根 .env 的 JARVIS_LLM_*(不覆盖已存在的进程 env,shell 显式设置优先)。
 * 解析失败静默忽略,回退 claude CLI 配置。
 */
function loadLocalEnvOverride(): void {
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url))
  if (!existsSync(rootEnv)) return
  try {
    for (const line of readFileSync(rootEnv, 'utf-8').split('\n')) {
      if (line.trimStart().startsWith('#')) continue
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadLocalEnvOverride()

/** .env 本地覆盖的模型 id;设置后所有别名都路由到它 */
function localOverrideModel(): string | undefined {
  return process.env.JARVIS_LLM_MODEL || undefined
}

/** jarvis config.model('sonnet' 等别名) → Pi model id */
export function resolveModelId(modelAlias: string): string {
  const local = localOverrideModel()
  if (local) return local
  return MODEL_ALIAS[modelAlias] || MODEL_ALIAS.sonnet
}

/**
 * 生成/刷新 jarvis 桥接 models.json 并返回路径。
 * 幂等:配置没变就不重写(避免运行时抖动)。
 */
function syncBridgeModels(): string | null {
  const settings = readClaudeSettings()
  const env = settings.env || {}
  const baseUrl = process.env.JARVIS_LLM_BASE_URL || env.ANTHROPIC_BASE_URL
  const apiKey = process.env.JARVIS_LLM_TOKEN || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY

  // 没有代理配置 → 返回 null(用 Pi 默认直连 anthropic,凭证来自 env/auth.json)
  if (!baseUrl || !apiKey) return null

  // .env 指定了模型 → 网关只注册这一个;否则按 claude 标准别名注册(代理自行映射)
  const local = localOverrideModel()
  // 本地网关模型默认按多模态注册（DeepSeek-V4.1-Flash-A 支持图像）。
  // 若某个网关只支持文本，可设 JARVIS_LLM_VISION=0 关闭，避免发送图像块。
  const vision = process.env.JARVIS_LLM_VISION !== '0'
  const models: Array<{ id: string; name: string; contextWindow: number; maxTokens: number; input: string[] }> = local
    ? [{ id: local, name: local, contextWindow: 128000, maxTokens: 16384, input: vision ? ['text', 'image'] : ['text'] }]
    : [
        { id: 'claude-sonnet-4-5', name: 'Sonnet (bridge)', contextWindow: 200000, maxTokens: 16384, input: ['text', 'image'] },
        { id: 'claude-opus-4-6', name: 'Opus (bridge)', contextWindow: 200000, maxTokens: 16384, input: ['text', 'image'] },
        { id: 'claude-haiku-4-5', name: 'Haiku (bridge)', contextWindow: 200000, maxTokens: 8192, input: ['text', 'image'] },
      ]

  const modelsJson = {
    providers: {
      [JARVIS_PROVIDER_ID]: {
        name: 'Jarvis LLM Bridge',
        baseUrl,
        api: 'anthropic-messages',
        apiKey,
        // Anthropic Messages API 同时认 x-api-key 和 Authorization: Bearer。
        // japi/DongCC 这类代理一般用 Bearer,两个都带上兼容面最大。
        authHeader: true,
        headers: {
          'anthropic-version': '2023-06-01',
        },
        models,
      },
    },
  }

  // 幂等:内容一致就不重写
  const serialized = JSON.stringify(modelsJson, null, 2)
  try {
    if (existsSync(BRIDGE_MODELS_PATH) && readFileSync(BRIDGE_MODELS_PATH, 'utf-8') === serialized) {
      return BRIDGE_MODELS_PATH
    }
  } catch { /* 重写 */ }

  mkdirSync(join(homedir(), '.pi', 'agent'), { recursive: true })
  writeFileSync(BRIDGE_MODELS_PATH, serialized, { encoding: 'utf-8', mode: 0o600 })
  try { chmodSync(BRIDGE_MODELS_PATH, 0o600) } catch { /* Windows 等 */ }
  return BRIDGE_MODELS_PATH
}

/**
 * 进程级共享的 ModelRuntime(创建开销大:读 catalog + auth)。
 * 优先挂用户桥接 provider(claude CLI 的代理凭证),否则 Pi 默认。
 */
let _modelRuntime: Promise<ModelRuntime> | null = null
export function getModelRuntime(): Promise<ModelRuntime> {
  if (!_modelRuntime) {
    _modelRuntime = (async () => {
      const bridgePath = syncBridgeModels()
      if (bridgePath) {
        try {
          return await ModelRuntime.create({ modelsPath: bridgePath })
        } catch (err) {
          console.warn(`[pi-models] 桥接 provider 加载失败,降级 Pi 默认: ${err instanceof Error ? err.message : err}`)
        }
      }
      return ModelRuntime.create()
    })()
  }
  return _modelRuntime
}

/**
 * 取桥接模型;桥接不可用时降级 Pi 内置 anthropic 直连(凭证走 env/auth.json)。
 * 返回 undefined 表示两端都没有(调用方应给出明确报错)。
 */
export async function getJarvisModel(modelAlias: string = 'sonnet') {
  const rt = await getModelRuntime()
  const modelId = resolveModelId(modelAlias)
  let model = rt.getModel(JARVIS_PROVIDER_ID, modelId)
  if (model) return model
  model = rt.getModel('anthropic', modelId)
  return model ?? undefined
}
