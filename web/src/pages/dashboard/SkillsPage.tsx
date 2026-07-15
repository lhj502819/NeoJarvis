import { useState, useEffect } from 'react'
import { fetchJSON, postJSON } from '../../api/client'
import type { SkillItem } from './types'
import { SkillIcon } from './components/SkillIcon'
import { DetailDrawer } from '../../components/DetailDrawer'

type FilterMode = 'all' | 'personal' | 'builtin'

// ─── Detail Panel ──────────────────────────────────────────────────────────

function SkillDetailPanel({
  skill,
  onToggle,
}: {
  skill: SkillItem
  onToggle: (name: string, next: boolean) => void
}) {
  const sourceLabel = skill.source === 'builtin' ? '内置' : '个人'
  const enabledLabel = skill.enabled ? '已启用' : '已禁用'

  return (
    <div className="skill-detail">
      {/* Hero */}
      <div className="skill-detail-hero">
        <div className="skill-detail-icon-wrap">
          <SkillIcon icon={skill.icon} source={skill.source} />
        </div>
        <div className="skill-detail-hero-info">
          <div className="skill-detail-name">{skill.name}</div>
          <div className="skill-detail-badges">
            <span className="skill-type-badge">{sourceLabel}</span>
            <span className={`skill-detail-status-badge${skill.enabled ? ' on' : ''}`}>
              {enabledLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="skill-detail-section-title">描述</div>
      <p className="skill-detail-desc">
        {skill.description || '(暂无描述)'}
      </p>

      {/* 能力清单 */}
      <div className="skill-detail-section-title">能力清单</div>
      <div className="skill-detail-capabilities">
        <p className="skill-detail-cap-hint">
          该技能会在合适时机被 Jarvis 或小弟自动加载,无需手动调用。
        </p>
      </div>

      {/* Action */}
      <div className="skill-detail-actions">
        <button
          className={`skill-detail-btn${skill.enabled ? ' skill-detail-btn-disable' : ' skill-detail-btn-enable'}`}
          type="button"
          onClick={() => onToggle(skill.name, !skill.enabled)}
        >
          {skill.enabled ? '禁用该技能' : '启用该技能'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export function SkillsPage() {
  const [items, setItems] = useState<SkillItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [selected, setSelected] = useState<SkillItem | null>(null)

  const load = async () => {
    const data = await fetchJSON<SkillItem[]>('/api/skills')
    setItems(data)
  }
  useEffect(() => { load().catch(console.error) }, [])

  // Keep selected in sync with items (so toggle reflects in detail panel)
  useEffect(() => {
    if (selected) {
      const updated = items.find(s => s.name === selected.name)
      if (updated) setSelected(updated)
    }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (name: string, next: boolean) => {
    setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: next } : s))  // 乐观更新
    try {
      const r = await postJSON<{ ok?: boolean; error?: string }>(`/api/skills/${encodeURIComponent(name)}/toggle`, { enabled: next })
      if (!r.ok) throw new Error(r.error ?? 'toggle failed')
    } catch {
      setItems(prev => prev.map(s => s.name === name ? { ...s, enabled: !next } : s))  // 回滚
    }
  }

  const visible = items.filter(s => {
    if (filter === 'personal' && s.source !== 'personal') return false
    if (filter === 'builtin' && s.source !== 'builtin') return false
    if (query) {
      const q = query.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  // 按 source 分组:个人 / 内置(排最后)
  const groups = new Map<string, SkillItem[]>()
  for (const s of visible) {
    const g = s.source === 'personal' ? '个人技能' : '内置技能'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === '个人技能') return 1
    if (b === '个人技能') return -1
    return a.localeCompare(b)
  })

  const enabledCount = items.filter(s => s.enabled).length

  // Effective selected (from current items so state is fresh)
  const effectiveSelected = selected
    ? items.find(s => s.name === selected.name) ?? selected
    : null

  return (
    <div className="dash-team-layout">
      {/* Left column */}
      <div className="dash-team-main">
        {/* Header */}
        <div className="tasks-page-header">
          <h1 className="tasks-page-title">技能</h1>
          <p className="tasks-page-subtitle">管理 Jarvis 可以调用的工具与技能 · 已启用 {enabledCount}/{items.length}</p>
        </div>

        {/* Toolbar */}
        <div className="skill-toolbar">
          <input
            className="skill-search"
            placeholder="搜索技能名或描述..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="skill-filter" value={filter} onChange={e => setFilter(e.target.value as FilterMode)}>
            <option value="all">全部 ({items.length})</option>
            <option value="personal">个人 ({items.filter(s => s.source === 'personal').length})</option>
            <option value="builtin">内置 ({items.filter(s => s.source === 'builtin').length})</option>
          </select>
        </div>

        {items.length === 0 && (
          <div className="dash-empty-hint">暂无技能(skills-hub 未同步到任何 skill)</div>
        )}

        {orderedGroups.map(([group, skills]) => (
          <div key={group} className="skill-group">
            <div className="skill-group-title">{group}</div>
            <div className="skill-grid">
              {skills.map(s => {
                const isActive = effectiveSelected?.name === s.name
                return (
                  <div
                    className={`skill-card skill-card-v2${s.enabled ? '' : ' skill-card-off'}${isActive ? ' dash-card-active' : ''}`}
                    key={s.name}
                    onClick={() => setSelected(s)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="skill-card-top">
                      <SkillIcon icon={s.icon} source={s.source} />
                      <div className="skill-meta">
                        <div className="skill-name">{s.name}</div>
                        <span className="skill-type-badge">
                          {s.source === 'builtin' ? '内置' : '个人'}
                        </span>
                        <div className="skill-desc">{s.description || '(无描述)'}</div>
                      </div>
                      <label
                        className="skill-toggle"
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={e => toggle(s.name, e.target.checked)}
                        />
                        <span className="skill-toggle-track"></span>
                      </label>
                    </div>
                    <div className="skill-card-foot">
                      <span className={`skill-status-label${s.enabled ? ' skill-status-on' : ''}`}>
                        {s.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right drawer — 仅在选中技能时渲染 */}
      {effectiveSelected && (
        <div className="dash-team-drawer-wrap">
          <DetailDrawer
            parentLabel="技能"
            onClose={() => setSelected(null)}
          >
            <SkillDetailPanel
              skill={effectiveSelected}
              onToggle={toggle}
            />
          </DetailDrawer>
        </div>
      )}
    </div>
  )
}
