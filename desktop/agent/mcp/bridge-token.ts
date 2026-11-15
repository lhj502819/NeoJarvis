import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * MCP 桥接的本机令牌。
 *
 * 外部 agent(Claude Code / Codex)通过 stdio MCP server 调 Jarvis 的内部 API,
 * 内部 API 不挂登录态(外部 agent 没有浏览器 cookie),改用本机令牌鉴权:
 *   - 首次读取时自动生成 ~/.jarvis/mcp-token(0600),服务端与 MCP server 共用这一份
 *   - env JARVIS_MCP_TOKEN 优先(测试/临时部署可覆盖)
 *
 * 令牌只防"本机其它进程误调/局域网误连",不是多用户隔离手段(单机单主人模型)。
 */
const TOKEN_PATH = join(homedir(), '.jarvis', 'mcp-token')

let cached: string | null = null

export function getBridgeToken(): string {
  const fromEnv = String(process.env.JARVIS_MCP_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  if (cached) return cached
  try {
    if (existsSync(TOKEN_PATH)) {
      const existing = readFileSync(TOKEN_PATH, 'utf8').trim()
      if (existing) { cached = existing; return existing }
    }
    mkdirSync(join(homedir(), '.jarvis'), { recursive: true })
    const token = randomBytes(24).toString('hex')
    writeFileSync(TOKEN_PATH, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(TOKEN_PATH, 0o600) } catch { /* 已存在时 chmod 失败可忽略 */ }
    cached = token
    return token
  } catch {
    // 极端情况(家目录只读):退回进程内随机值,重启即失效 —— 至少不裸奔
    if (!cached) cached = randomBytes(24).toString('hex')
    return cached
  }
}

/** 常量时间比较(长度不同直接 false)。 */
export function verifyBridgeToken(provided: unknown): boolean {
  const expected = getBridgeToken()
  const value = String(provided ?? '')
  if (!value || value.length !== expected.length) return false
  // 手工常量时间比较,避免引入额外依赖
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export const BRIDGE_TOKEN_PATH = TOKEN_PATH
