import { agentEnv } from './config.js'
import { resolveCredential } from '../auth/credentials.js'

// 每次返回新对象，绝不修改全局 agentEnv、绝不写 process.env（并发隔离红线）
export function buildUserEnv(userId: string, tier?: string): Record<string, string> {
  const cred = resolveCredential(userId, tier)
  if (!cred) return { ...agentEnv }  // 无凭证 → 回退平台默认（返回新对象，不暴露引用）

  const env = { ...agentEnv }

  // 安全隔离：删除平台认证变量，防止平台密钥泄露给用户自带的 base_url。
  // claude CLI 优先读取 ANTHROPIC_AUTH_TOKEN；若不删除，用户的 ANTHROPIC_API_KEY 永远不生效，
  // 且平台 token 会作为 Bearer 发往用户填写的任意第三方 base_url（平台密钥泄露）。
  delete env.ANTHROPIC_AUTH_TOKEN

  // 删除所有平台模型别名（ANTHROPIC_DEFAULT_SONNET_MODEL / OPUS / HAIKU 及各自的 _NAME 变体）。
  // 这些别名可能覆盖或干扰用户显式指定的 ANTHROPIC_MODEL；遍历删除以覆盖未来新增的别名。
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_DEFAULT_')) {
      delete env[key]
    }
  }

  env.ANTHROPIC_API_KEY = cred.apiKey
  env.ANTHROPIC_BASE_URL = cred.baseUrl
  env.ANTHROPIC_MODEL = cred.model

  return env
}
