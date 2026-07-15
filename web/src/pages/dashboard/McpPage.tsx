import { useState, useEffect } from 'react'
import { fetchJSON, postJSON } from '../../api/client'
import { DetailDrawer } from '../../components/DetailDrawer'

/**
 * MCP 管理页 —— 对称 SkillsPage:左列表(卡片)+ 点击才弹右抽屉(DetailDrawer)。
 *
 * 数据源:GET /api/mcp(TS 智能层合并 ~/.claude.json hub + DB user + 启禁状态)。
 * 切换:POST /api/mcp/{name}/toggle,乐观更新 + 回滚(照 SkillsPage:90 的做法)。
 *
 * 安全:envKeys 只显示 key 名(不含 value),永不显示 env value 明文。
 */

interface McpItem {
  name: string
  type: string             // stdio / sse / http / ws
  source: 'personal' | 'user'
  enabled: boolean
  envKeys?: string[]
  command?: string
  args?: string[]
  url?: string
  description?: string
}

type FilterMode = 'all' | 'personal' | 'user'

// ─── Icon ──────────────────────────────────────────────────────────────────

// 默认 MCP 图标:插头(与"外部工具服务器"语义呼应,和 SkillIcon 保持不同视觉)
const DEFAULT_MCP_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0V8z" />
    <path d="M12 17v5" />
  </svg>
)

function McpIcon() {
  return <span className="skill-icon">{DEFAULT_MCP_ICON}</span>
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// 常见 secret 模式:`--api-key=xxx` / `--token xxx` / 40+ 位 hex 或 base64 单串
const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|auth|bearer)/i
function redactArg(arg: string, prev: string | undefined): string {
  // 上一个是 --api-key/--token 之类,当前 arg 是它的值 → 脱敏
  if (prev && SECRET_KEY_RE.test(prev.replace(/^-+/, ''))) return '***'
  // arg 自己是 `--api-key=xxx` 形式 → 保留 key 名,value 脱敏
  const m = arg.match(/^(--?[^=]+)=(.+)$/)
  if (m && SECRET_KEY_RE.test(m[1].replace(/^-+/, ''))) return `${m[1]}=***`
  return arg
}
function redactArgs(args: string[]): string[] {
  return args.map((a, i) => redactArg(a, args[i - 1]))
}

// stdio 简写:`command arg0 arg1`(最多前两个 arg,便于长命令截断;secret 脱敏)
function stdioSummary(item: McpItem): string {
  if (!item.command) return ''
  const args = redactArgs((item.args || []).slice(0, 2)).join(' ')
  return args ? `${item.command} ${args}` : item.command
}

// URL host 简写(sse/http/ws 用)
function urlHost(item: McpItem): string {
  if (!item.url) return ''
  try {
    const u = new URL(item.url)
    return u.host + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return item.url
  }
}

function typeBadgeClass(type: string): string {
  // 通过 CSS var 颜色区分 stdio/sse/http/ws;未知类型走默认灰
  const t = type.toLowerCase()
  if (t === 'stdio') return 'mcp-type-badge mcp-type-stdio'
  if (t === 'sse') return 'mcp-type-badge mcp-type-sse'
  if (t === 'http') return 'mcp-type-badge mcp-type-http'
  if (t === 'ws') return 'mcp-type-badge mcp-type-ws'
  return 'mcp-type-badge'
}

function sourceLabel(source: McpItem['source']): string {
  return source === 'personal' ? '本机' : '自加'
}

// ─── Detail Panel ──────────────────────────────────────────────────────────

function McpDetailPanel({
  item,
  onToggle,
}: {
  item: McpItem
  onToggle: (name: string, next: boolean) => void
}) {
  const enabledLabel = item.enabled ? '已启用' : '已禁用'
  const stdio = stdioSummary(item)
  const host = urlHost(item)

  return (
    <div className="skill-detail">
      {/* Hero */}
      <div className="skill-detail-hero">
        <div className="skill-detail-icon-wrap">
          <McpIcon />
        </div>
        <div className="skill-detail-hero-info">
          <div className="skill-detail-name">{item.name}</div>
          <div className="skill-detail-badges">
            <span className={typeBadgeClass(item.type)}>{item.type}</span>
            <span className="skill-type-badge">{sourceLabel(item.source)}</span>
            <span className={`skill-detail-status-badge${item.enabled ? ' on' : ''}`}>
              {enabledLabel}
            </span>
          </div>
        </div>
      </div>

      {/* 描述(可选) */}
      {item.description && (
        <>
          <div className="skill-detail-section-title">描述</div>
          <p className="skill-detail-desc">{item.description}</p>
        </>
      )}

      {/* 连接方式 */}
      <div className="skill-detail-section-title">连接方式</div>
      <div className="mcp-detail-kv">
        <div className="mcp-detail-kv-row">
          <span className="mcp-detail-kv-key">类型</span>
          <span className="mcp-detail-kv-val mcp-mono">{item.type}</span>
        </div>
        {stdio && (
          <div className="mcp-detail-kv-row">
            <span className="mcp-detail-kv-key">命令</span>
            <span className="mcp-detail-kv-val mcp-mono">{stdio}</span>
          </div>
        )}
        {host && (
          <div className="mcp-detail-kv-row">
            <span className="mcp-detail-kv-key">地址</span>
            <span className="mcp-detail-kv-val mcp-mono">{host}</span>
          </div>
        )}
        <div className="mcp-detail-kv-row">
          <span className="mcp-detail-kv-key">来源</span>
          <span className="mcp-detail-kv-val">{item.source === 'personal' ? '本机 ~/.claude.json' : 'Jarvis 自加(DB)'}</span>
        </div>
      </div>

      {/* env keys(如有) */}
      {item.envKeys && item.envKeys.length > 0 && (
        <>
          <div className="skill-detail-section-title">环境变量</div>
          <div className="mcp-env-keys">
            <p className="skill-detail-cap-hint">
              仅显示环境变量名,值不会离开本机智能层。
            </p>
            <div className="mcp-env-keys-list">
              {item.envKeys.map(k => (
                <span key={k} className="mcp-env-key-chip">{k}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Action */}
      <div className="skill-detail-actions">
        <button
          className={`skill-detail-btn${item.enabled ? ' skill-detail-btn-disable' : ' skill-detail-btn-enable'}`}
          type="button"
          onClick={() => onToggle(item.name, !item.enabled)}
        >
          {item.enabled ? '禁用该 MCP' : '启用该 MCP'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export function McpPage() {
  const [items, setItems] = useState<McpItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [selected, setSelected] = useState<McpItem | null>(null)

  const load = async () => {
    const data = await fetchJSON<McpItem[]>('/api/mcp')
    setItems(data)
  }
  useEffect(() => { load().catch(console.error) }, [])

  // Keep selected in sync with items (so toggle reflects in detail panel)
  useEffect(() => {
    if (selected) {
      const updated = items.find(m => m.name === selected.name)
      if (updated) setSelected(updated)
    }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (name: string, next: boolean) => {
    setItems(prev => prev.map(m => m.name === name ? { ...m, enabled: next } : m))  // 乐观更新
    try {
      const r = await postJSON<{ ok?: boolean; error?: string }>(`/api/mcp/${encodeURIComponent(name)}/toggle`, { enabled: next })
      if (!r.ok) throw new Error(r.error ?? 'toggle failed')
    } catch {
      setItems(prev => prev.map(m => m.name === name ? { ...m, enabled: !next } : m))  // 回滚
    }
  }

  const visible = items.filter(m => {
    if (filter === 'personal' && m.source !== 'personal') return false
    if (filter === 'user' && m.source !== 'user') return false
    if (query) {
      const q = query.toLowerCase()
      const hay = [m.name, m.description || '', stdioSummary(m), urlHost(m)].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // 按 source 分组:本机 MCP / Jarvis 自加(自加排最后,与 SkillsPage 个人 vs 内置的排序方向一致)
  const groups = new Map<string, McpItem[]>()
  for (const m of visible) {
    const g = m.source === 'personal' ? '本机 MCP' : 'Jarvis 自加'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(m)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    // 本机在前,自加在后
    if (a === '本机 MCP') return -1
    if (b === '本机 MCP') return 1
    return a.localeCompare(b)
  })

  const enabledCount = items.filter(m => m.enabled).length
  const personalCount = items.filter(m => m.source === 'personal').length
  const userCount = items.filter(m => m.source === 'user').length

  // Effective selected (from current items so state is fresh)
  const effectiveSelected = selected
    ? items.find(m => m.name === selected.name) ?? selected
    : null

  return (
    <div className="dash-team-layout">
      {/* Left column */}
      <div className="dash-team-main">
        {/* Header */}
        <div className="tasks-page-header">
          <h1 className="tasks-page-title">MCP 服务器</h1>
          <p className="tasks-page-subtitle">
            Jarvis 和小弟可以调用的外部工具服务器 · 已启用 {enabledCount}/{items.length}
          </p>
        </div>

        {/* Toolbar */}
        <div className="skill-toolbar">
          <input
            className="skill-search"
            placeholder="搜索 MCP 名 / 命令 / 地址..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="skill-filter" value={filter} onChange={e => setFilter(e.target.value as FilterMode)}>
            <option value="all">全部 ({items.length})</option>
            <option value="personal">本机 ({personalCount})</option>
            <option value="user">自加 ({userCount})</option>
          </select>
        </div>

        {items.length === 0 && (
          <div className="dash-empty-hint">
            暂无 MCP(未在 ~/.claude.json 里配置任何 mcpServers,也未在 Jarvis 里自加)
          </div>
        )}

        {orderedGroups.map(([group, mcps]) => (
          <div key={group} className="skill-group">
            <div className="skill-group-title">{group}</div>
            <div className="skill-grid">
              {mcps.map(m => {
                const isActive = effectiveSelected?.name === m.name
                const stdio = stdioSummary(m)
                const host = urlHost(m)
                const endpoint = stdio || host
                return (
                  <div
                    className={`skill-card skill-card-v2${m.enabled ? '' : ' skill-card-off'}${isActive ? ' dash-card-active' : ''}`}
                    key={m.name}
                    onClick={() => setSelected(m)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="skill-card-top">
                      <McpIcon />
                      <div className="skill-meta">
                        <div className="skill-name">{m.name}</div>
                        <div className="mcp-card-badges">
                          <span className={typeBadgeClass(m.type)}>{m.type}</span>
                          {m.envKeys && m.envKeys.length > 0 && (
                            <span className="mcp-env-badge" title={`需要环境变量: ${m.envKeys.join(', ')}`}>
                              env: {m.envKeys.join(', ')}
                            </span>
                          )}
                        </div>
                        {endpoint && (
                          <div className="skill-desc mcp-mono">{endpoint}</div>
                        )}
                      </div>
                      <label
                        className="skill-toggle"
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={e => toggle(m.name, e.target.checked)}
                        />
                        <span className="skill-toggle-track"></span>
                      </label>
                    </div>
                    <div className="skill-card-foot">
                      <span className={`skill-status-label${m.enabled ? ' skill-status-on' : ''}`}>
                        {m.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right drawer — 仅在选中 MCP 时渲染 */}
      {effectiveSelected && (
        <div className="dash-team-drawer-wrap">
          <DetailDrawer
            parentLabel="MCP"
            onClose={() => setSelected(null)}
          >
            <McpDetailPanel
              item={effectiveSelected}
              onToggle={toggle}
            />
          </DetailDrawer>
        </div>
      )}
    </div>
  )
}
