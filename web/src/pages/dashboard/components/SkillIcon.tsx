import type { ReactElement } from 'react'

// 默认图标:四角星带右上小十字(用户指定)。内置 skill 可用 icon 字段指定品牌图标。
const DEFAULT_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 3c.3 2.6 1.4 3.7 4 4-2.6.3-3.7 1.4-4 4-.3-2.6-1.4-3.7-4-4 2.6-.3 3.7-1.4 4-4z" />
    <path d="M19 4v3M17.5 5.5h3" />
    <circle cx="6" cy="17" r="1" />
  </svg>
)

// 内置图标集:key = SKILL.md 里的 icon 字段值
const BRAND_ICONS: Record<string, ReactElement> = {
  github: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5 3.9-1.4 6.8-5.2 6.8-9.7C22 6.6 17.5 2 12 2z"/></svg>
  ),
  apple: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 2c0 1.2-.5 2.3-1.3 3.1-.8.9-2.1 1.6-3.2 1.5-.1-1.2.5-2.4 1.2-3.1C13.5 2.6 14.9 2 16 2zm3.5 15.5c-.6 1.4-.9 2-1.7 3.2-1.1 1.7-2.6 3.8-4.5 3.8-1.7 0-2.1-1.1-4.4-1.1s-2.8 1.1-4.4 1.1c-1.9 0-3.3-1.9-4.4-3.6C-.6 17.6-.9 12 1.9 9.1 3 7.7 4.7 6.9 6.3 6.9c1.7 0 2.8 1.1 4.2 1.1 1.4 0 2.2-1.1 4.2-1.1 1.4 0 2.9.8 4 2.1-3.5 1.9-2.9 6.9.8 8.5z"/></svg>
  ),
  google: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 11v2.8h4c-.2 1-1.3 3-4 3-2.4 0-4.4-2-4.4-4.5S9.6 7.8 12 7.8c1.4 0 2.3.6 2.8 1.1l1.9-1.8C15.5 5.9 13.9 5.2 12 5.2 8.2 5.2 5.2 8.3 5.2 12s3 6.8 6.8 6.8c3.9 0 6.5-2.7 6.5-6.6 0-.5 0-.8-.1-1.2H12z"/></svg>
  ),
  wechat: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4C4.9 4 1.6 6.8 1.6 10.2c0 1.9 1 3.6 2.7 4.8L3.4 17l2.4-1.2c.9.3 1.8.4 2.7.4h.6a5.2 5.2 0 0 1-.3-1.8c0-3.2 3-5.7 6.8-5.7h.6C15.7 6 12.7 4 9 4zm7.2 5.4c-3.1 0-5.6 2.1-5.6 4.7s2.5 4.7 5.6 4.7c.7 0 1.4-.1 2-.3l1.9 1-.5-1.6c1.3-.9 2.2-2.3 2.2-3.8 0-2.6-2.5-4.7-5.6-4.7z"/></svg>
  ),
}

export function SkillIcon({ icon, source }: { icon?: string; source: 'builtin' | 'personal' }) {
  const el = source === 'builtin' && icon && BRAND_ICONS[icon] ? BRAND_ICONS[icon] : DEFAULT_ICON
  return <span className="skill-icon">{el}</span>
}
