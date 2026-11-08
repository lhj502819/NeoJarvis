import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface Config {
  jarvisPort: number
  agentBasePort: number
  model: string
}

export const config: Config = {
  // 端口可用环境变量覆盖(本地多实例/端口冲突时):JARVIS_PORT=3005 npm run dev
  jarvisPort: Number(process.env.JARVIS_PORT) || 3000,
  agentBasePort: Number(process.env.AGENT_BASE_PORT) || 3001,
  model: 'sonnet',
}

function loadClaudeSettingsEnv(): Record<string, string> {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return settings.env || {}
  } catch {
    return {}
  }
}

const claudeEnv = loadClaudeSettingsEnv()

// Pi SDK(ModelRuntime)在进程内调用 LLM,从 process.env 读凭证。
// 旧 Claude SDK 是 spawn 子进程把 agentEnv 传过去;Pi 需要把 ~/.claude/settings.json 的 env
// 合并进 process.env,让 Pi 的 anthropic provider resolve 读到 ANTHROPIC_AUTH_TOKEN/BASE_URL/
// ANTHROPIC_DEFAULT_*_MODEL 等凭证与模型映射。
// 用户已显式设置的 env 不覆盖(除非 ~/.claude/settings.json 显式定义该 key)。
// 注意:CLAUDE.md 安全红线 —— 平台注入的 ANTHROPIC_AUTH_TOKEN 在用户配了自己的凭证后必须从 env
// 删除,不能泄漏给小弟进程。这里用 claudeEnv 覆盖正是为了用用户凭证替换平台 token。
for (const [k, v] of Object.entries(claudeEnv)) {
  if (typeof v === 'string' && v.length > 0) process.env[k] = v
}

export const agentEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  ...claudeEnv,
}
