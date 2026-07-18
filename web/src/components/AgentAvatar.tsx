/**
 * 小弟拟人化头像:种子串 hash 出柔和背景色 + 居中 emoji。
 *
 * - seed:稳定标识(传 recipe.id;name 会随拟人化改名,不能当种子)
 * - emoji:recipe.avatar(Jarvis 晋升时选的 emoji);缺省时兜底渲染 fallback/seed 首字符
 *
 * 零依赖(项目无头像库),纯 inline style。字段设计兼容以后 avatar 换成真实图 URL:
 * 届时在此判断 emoji 是否以 http 开头,是则渲染 <img>。
 */

function hashHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}

/** 单个 emoji(含代理对/变体选择符)通常 ≤ 3 code unit;超过就当普通文本取首字符。 */
function isEmoji(s: string): boolean {
  return [...s].length <= 2 && !/^[a-zA-Z0-9]/.test(s)
}

export function AgentAvatar({
  seed,
  emoji,
  fallback,
  size = 40,
  radius,
  className,
}: {
  seed: string
  emoji?: string
  /** emoji 缺省时的兜底字符来源(通常传 name);再缺省用 seed 首字符 */
  fallback?: string
  size?: number
  radius?: number
  className?: string
}) {
  const hue = hashHue(seed || fallback || '?')
  const bg = `hsl(${hue}, 55%, 88%)`
  const fg = `hsl(${hue}, 45%, 32%)`

  const hasEmoji = emoji && isEmoji(emoji.trim())
  const glyph = hasEmoji ? emoji!.trim() : (fallback || seed || '?').trim().slice(0, 1).toUpperCase()

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size / 3),
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: hasEmoji ? Math.round(size * 0.55) : Math.round(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {glyph}
    </div>
  )
}
