import { existsSync } from 'fs'

/**
 * 派单前校验 Jarvis 生成的 cwd。
 *
 * 背景:Jarvis 用 LLM 生成 create_task 的 JSON 时,可能幻觉出不存在的路径
 * (如 /Users/hh/... 而实际用户名不同)。这个错误的 cwd 会传给 SDK spawn,
 * Node 抛 ENOENT,SDK 又把它包装成误导性的"native binary failed to launch"
 * 消息,层层误导用户。
 *
 * 这个函数是防线:只放行绝对路径且实际存在的 cwd,其他统统丢弃。
 * cwd 为空是合法的(纯调研/生活类任务不需要),因此空输入直接返回 undefined。
 */
export function sanitizeCwd(cwd: string | undefined | null): string | undefined {
  if (!cwd || typeof cwd !== 'string') return undefined
  const trimmed = cwd.trim()
  if (!trimmed) return undefined
  // 只接受绝对路径——相对路径歧义太大
  if (!trimmed.startsWith('/')) return undefined
  if (!existsSync(trimmed)) return undefined
  return trimmed
}
