import { useState, useEffect } from 'react'
import { fetchJSON } from '../../api/client'
import { ArtifactPanel, type Artifact } from '../../components/ArtifactPanel'

interface ArtifactListItem {
  id: string
  type: string
  title: string
  language?: string
  version: number
  created_at: number
  updated_at?: number
}

const TYPE_LABELS: Record<string, string> = { html: '🌐 网页', markdown: '📄 文档', code: '💻 代码', mermaid: '📊 图表' }
const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'markdown', label: '文档' },
  { value: 'html', label: '网页' },
  { value: 'code', label: '代码' },
  { value: 'mermaid', label: '图表' },
]

export function ArtifactsPage() {
  const [items, setItems] = useState<ArtifactListItem[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<ArtifactListItem | null>(null)
  const [preview, setPreview] = useState<Artifact | null>(null)

  const load = async () => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (typeFilter) params.set('type', typeFilter)
    params.set('limit', '50')
    const data = await fetchJSON<{ total: number; items: ArtifactListItem[] }>(`/api/artifacts?${params}`)
    setItems(data.items)
    setTotal(data.total)
  }

  useEffect(() => { load() }, [query, typeFilter])

  const openPreview = async (item: ArtifactListItem) => {
    setSelected(item)
    const data = await fetchJSON<Artifact>(`/api/artifact/${item.id}`)
    setPreview(data)
  }

  return (
    <div className="dash-artifacts-layout">
      {/* 左列表 */}
      <div className="dash-artifacts-list-col">
        <div className="dash-artifacts-head">
          <div className="dash-section-title">制品库 <span className="dash-artifacts-count">{total}</span></div>
          <div className="dash-artifacts-sub">所有生成的报告、网页、代码与图表</div>
        </div>
        <div className="dash-artifacts-search">
          <input
            className="dash-input-glass"
            placeholder="🔍 搜索标题或内容..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="dash-artifacts-tabs">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              className={`dash-tab-chip${typeFilter === f.value ? ' active' : ''}`}
              onClick={() => setTypeFilter(f.value)}
              type="button"
            >{f.label}</button>
          ))}
        </div>
        <div className="dash-artifacts-list-scroll">
          {items.length > 0 ? items.map(item => (
            <div
              className={`dash-card dash-clickable dash-artifact-row${selected?.id === item.id ? ' selected' : ''}`}
              key={item.id}
              onClick={() => openPreview(item)}
            >
              <div className="dash-artifact-row-head">
                <span className="dash-artifact-type-chip">{TYPE_LABELS[item.type] || item.type}</span>
                <span className="dash-artifact-title-text">{item.title}</span>
              </div>
              <div className="dash-artifact-row-meta">
                <span>v{item.version}</span>
                <span>·</span>
                <span>{new Date(item.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          )) : <div className="dash-empty-hint">暂无制品</div>}
        </div>
      </div>

      {/* 右预览 */}
      <div className="dash-artifacts-preview-col">
        {preview ? (
          <ArtifactPanel artifact={preview} onClose={() => { setPreview(null); setSelected(null) }} />
        ) : (
          <div className="dash-artifacts-empty">
            <div className="dash-artifacts-empty-icon">📦</div>
            <div>点击左侧制品查看预览</div>
          </div>
        )}
      </div>
    </div>
  )
}
