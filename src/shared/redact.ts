/**
 * 敏感 token 清洗。
 *
 * 用于「不删聊天记录、但不让 token 无限扩散」——
 * 落 db 的原文保留（用户可回看），但喂给 LLM 的上下文和发去
 * EverOS 长记忆的对话副本，会先经过这个函数替换成 [REDACTED]。
 *
 * 匹配策略：宁可漏一两个不常见 token，也不误伤正常对话。
 * 只匹配有明显前缀/结构的 token 格式，不做泛式 base64 匹配。
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Anthropic / DeepSeek / OpenAI API key（sk- 开头，20+ 位）
  { name: 'sk', re: /sk-[a-zA-Z0-9_-]{20,}/g },
  // GitHub PAT / OAuth（含下划线也匹配，覆盖 fake / 未来变种）
  { name: 'github', re: /gh[pousr]_[a-zA-Z0-9_]{20,}/g },
  { name: 'github-pat', re: /github_pat_[a-zA-Z0-9_]{20,}/g },
  // Slack
  { name: 'slack', re: /xox[bpsare]-[a-zA-Z0-9-]{10,}/g },
  // Bearer <base64ish>（20+ 位，允许 . _ -，覆盖 JWT）
  { name: 'bearer', re: /Bearer\s+[a-zA-Z0-9._-]{20,}/g },
  // 长 hex（40+ 位，覆盖 SHA-1/256、api-key hex）
  { name: 'hex', re: /\b[a-f0-9]{40,}\b/g },
]

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const { re } of PATTERNS) {
    out = out.replace(re, '[REDACTED]')
  }
  return out
}
