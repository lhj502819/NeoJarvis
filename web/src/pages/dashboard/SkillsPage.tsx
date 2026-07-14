import { useState, useEffect } from 'react'
import { fetchJSON, postJSON } from '../../api/client'
import type { SkillItem } from './types'
import { SkillIcon } from './components/SkillIcon'

type FilterMode = 'all' | 'enabled' | 'disabled'

export function SkillsPage() {
  const [items, setItems] = useState<SkillItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

  const load = async () => {
    const data = await fetchJSON<SkillItem[]>('/api/skills')
    setItems(data)
  }
  useEffect(() => { load() }, [])

  const toggle = async (name: string, next: boolean) => {
    setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: next } : s))  // 乐观更新
    try {
      await postJSON(`/api/skills/${encodeURIComponent(name)}/toggle`, { enabled: next })
    } catch {
      setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: !next } : s))  // 回滚
    }
  }

  const visible = items.filter(s => {
    if (filter === 'enabled' && !s.enabled) return false
    if (filter === 'disabled' && s.enabled) return false
    if (query) {
      const q = query.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  // 按分类分组:内置 skill 用各自 category;个人 skill 归「个人」组(排最后)
  const groups = new Map<string, SkillItem[]>()
  for (const s of visible) {
    const g = s.source === 'personal' ? '个人' : (s.category || '其他')
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === '个人') return 1
    if (b === '个人') return -1
    return a.localeCompare(b)
  })

  const enabledCount = items.filter(s => s.enabled).length

  return (
    <div>
      <div className="dash-section-title">技能 ({enabledCount}/{items.length} 启用)</div>
      <div className="skill-toolbar">
        <input
          className="skill-search"
          placeholder="搜索技能名或描述..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select className="skill-filter" value={filter} onChange={e => setFilter(e.target.value as FilterMode)}>
          <option value="all">全部</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已禁用</option>
        </select>
      </div>

      {items.length === 0 && <div className="dash-empty-hint">暂无技能(skills-hub 未同步到任何 skill)</div>}

      {orderedGroups.map(([group, skills]) => (
        <div key={group} className="skill-group">
          <div className="skill-group-title">{group}</div>
          <div className="skill-grid">
            {skills.map(s => (
              <div className={`skill-card${s.enabled ? '' : ' skill-card-off'}`} key={s.name}>
                <SkillIcon icon={s.icon} source={s.source} />
                <div className="skill-meta">
                  <div className="skill-name">{s.name}</div>
                  <div className="skill-desc">{s.description || '(无描述)'}</div>
                </div>
                <label className="skill-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={e => toggle(s.name, e.target.checked)} />
                  <span className="skill-toggle-track"></span>
                </label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
