import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, statSync, readFileSync, lstatSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'plugins', 'skills-hub')
const HUB_SKILLS = join(HUB_DIR, 'skills')

// 全局 skill 生态来源(按优先级;同名时先出现的胜出)
const SOURCES = [
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
]

export function getSkillsHubDir(): string {
  return HUB_DIR
}

// 一个目录是不是合法 skill(含 SKILL.md)
function isSkillDir(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, 'SKILL.md'))
  } catch {
    return false
  }
}

// 启动时把两套生态的 skill 软链进 hub。返回纳入的 skill 名列表。
export function syncSkillsHub(): string[] {
  mkdirSync(HUB_SKILLS, { recursive: true })

  // 清掉旧软链(只删 symlink,保留真实目录如手写 skill)
  for (const entry of readdirSync(HUB_SKILLS)) {
    const p = join(HUB_SKILLS, entry)
    try {
      if (lstatSync(p).isSymbolicLink()) rmSync(p)
    } catch { /* ignore */ }
  }

  const linked: string[] = []
  const seen = new Set<string>()
  for (const src of SOURCES) {
    if (!existsSync(src)) continue
    for (const name of readdirSync(src)) {
      if (seen.has(name)) continue
      const target = join(src, name)
      if (!isSkillDir(target)) continue
      try {
        symlinkSync(target, join(HUB_SKILLS, name), 'dir')
        seen.add(name)
        linked.push(name)
      } catch { /* 冲突或权限问题,跳过 */ }
    }
  }
  return linked.sort()
}

export interface HubSkill {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
}

// 解析 SKILL.md frontmatter:标准 description + 我们的自定义扩展字段 category/icon
function parseFrontmatter(text: string): { description: string; category?: string; icon?: string } {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return { description: '' }
  const block = fm[1]
  const pick = (key: string) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  return {
    description: pick('description') || '',
    category: pick('category'),
    icon: pick('icon'),
  }
}

// 一个 hub 条目是软链(个人)还是真实目录(内置)
function skillSource(name: string): 'builtin' | 'personal' {
  try {
    return lstatSync(join(HUB_SKILLS, name)).isSymbolicLink() ? 'personal' : 'builtin'
  } catch {
    return 'personal'
  }
}

// 读 hub 里每个 skill 的 name/description/category/icon/source
export function listHubSkills(): HubSkill[] {
  if (!existsSync(HUB_SKILLS)) return []
  const skills: HubSkill[] = []
  for (const name of readdirSync(HUB_SKILLS)) {
    const md = join(HUB_SKILLS, name, 'SKILL.md')
    if (!existsSync(md)) continue
    try {
      const meta = parseFrontmatter(readFileSync(md, 'utf-8'))
      skills.push({ name, description: meta.description, category: meta.category, icon: meta.icon, source: skillSource(name) })
    } catch { /* ignore */ }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}
