import pool from '../shared/db.js'

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
