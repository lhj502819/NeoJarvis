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

export function ArtifactsPage() {
  const [items, setItems] = useState<ArtifactListItem[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
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
    const data = await fetchJSON<Artifact>(`/api/artifact/${item.id}`)
    setPreview(data)
  }

  if (preview) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <button className="dash-back-btn" onClick={() => setPreview(null)}>← 返回制品库</button>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ArtifactPanel artifact={preview} onClose={() => setPreview(null)} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="dash-section-title">制品库 ({total})</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          placeholder="搜索标题或内容..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
        >
          <option value="">全部类型</option>
          <option value="html">网页</option>
          <option value="markdown">文档</option>
          <option value="code">代码</option>
          <option value="mermaid">图表</option>
        </select>
      </div>
      {items.length > 0 ? items.map(item => (
        <div className="dash-card dash-clickable" key={item.id} onClick={() => openPreview(item)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>{TYPE_LABELS[item.type] || item.type}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</span>
            {item.version > 1 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{item.version}</span>}
          </div>
          <div className="dash-profile-meta" style={{ marginTop: 6 }}>
            <span>{new Date(item.created_at).toLocaleDateString()}</span>
            {item.updated_at && <span>更新: {new Date(item.updated_at).toLocaleDateString()}</span>}
          </div>
        </div>
      )) : <div className="dash-empty-hint">暂无制品</div>}
    </div>
  )
}
