import pool from '../shared/db.js'
import { listHubSkills } from './skills-hub.js'

// 黑名单模型:表里有行 = 该用户禁用了这个 skill。空 = 全部启用。
export async function getDisabledSkills(userId: string): Promise<Set<string>> {
  const { rows } = await pool.query(
    'SELECT skill_name FROM jarvis_skill_prefs WHERE user_id = $1',
    [userId]
  )
  return new Set(rows.map((r: any) => r.skill_name))
}

export async function setSkillEnabled(userId: string, name: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await pool.query('DELETE FROM jarvis_skill_prefs WHERE user_id = $1 AND skill_name = $2', [userId, name])
  } else {
    await pool.query(
      'INSERT INTO jarvis_skill_prefs (user_id, skill_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, name]
    )
  }
}

// 管道类 skill:Jarvis 内部机制(晋升等),恒加载、不进管理页、不受启禁影响
export const PIPELINE_SKILLS = ['promote-agent']

export interface SkillView {
  name: string
  description: string
  category?: string
  icon?: string
  source: 'builtin' | 'personal'
  enabled: boolean
}

// 给管理页用:合并 hub skill + 该用户 enabled 状态,排除管道 skill
export async function listSkillsForUser(userId: string): Promise<SkillView[]> {
  const disabled = await getDisabledSkills(userId)
  return listHubSkills()
    .filter(s => !PIPELINE_SKILLS.includes(s.name))
    .map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
      icon: s.icon,
      source: s.source,
      enabled: !disabled.has(s.name),
    }))
}

// 给派单/prompt 注入用:启用的 hub skill 名(不含管道 skill——管道 skill 由调用方单独 prepend)
export async function getEnabledHubSkills(userId: string): Promise<string[]> {
  const disabled = await getDisabledSkills(userId)
  return listHubSkills()
    .map(s => s.name)
    .filter(name => !PIPELINE_SKILLS.includes(name) && !disabled.has(name))
}
