import { agentEnv } from './config.js'
import { resolveCredential } from '../auth/credentials.js'

// 每次返回新对象，绝不修改全局 agentEnv、绝不写 process.env（并发隔离红线）
export function buildUserEnv(userId: string, tier?: string): Record<string, string> {
  const cred = resolveCredential(userId, tier)
  if (!cred) return agentEnv  // 无凭证 → 回退平台默认
  return {
    ...agentEnv,
    ANTHROPIC_API_KEY: cred.apiKey,
    ANTHROPIC_BASE_URL: cred.baseUrl,
    ANTHROPIC_MODEL: cred.model,
  }
}
