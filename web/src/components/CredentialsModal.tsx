import { useEffect, useState } from 'react'
import { listCredentials, createCredential, updateCredential, deleteCredential, type Credential, type CredentialInput } from '../api/credentials'

interface Props {
  open: boolean
  onClose: () => void
}

const TIER_LABELS: Record<string, string> = { fast: '快速', standard: '标准', strong: '强力' }
const EMPTY_FORM = { label: '', tier: 'standard', apiKey: '', baseUrl: '', model: '', isDefault: false }

export function CredentialsModal({ open, onClose }: Props) {
  const [creds, setCreds] = useState<Credential[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [keyChanged, setKeyChanged] = useState(false)

  const refresh = async () => {
    setLoading(true); setError('')
    try { setCreds(await listCredentials()) }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) { refresh(); setEditing(null); setForm(EMPTY_FORM); setKeyChanged(false) } }, [open])

  if (!open) return null

  const startNew = () => { setForm(EMPTY_FORM); setKeyChanged(true); setEditing('new') }
  const startEdit = (c: Credential) => {
    setForm({ label: c.label, tier: c.tier, apiKey: '', baseUrl: c.baseUrl, model: c.model, isDefault: c.isDefault })
    setKeyChanged(false)
    setEditing(c.id)
  }

  const save = async () => {
    setError('')
    try {
      if (editing === 'new') {
        if (!form.label || !form.apiKey || !form.baseUrl || !form.model) { setError('请填写所有必填项'); return }
        await createCredential({ ...form, tier: form.tier as CredentialInput['tier'] })
      } else if (editing) {
        if (keyChanged && !form.apiKey) { setError('请输入新的 API Key'); return }
        const body: Partial<CredentialInput> = { label: form.label, tier: form.tier as CredentialInput['tier'], baseUrl: form.baseUrl, model: form.model, isDefault: form.isDefault }
        if (keyChanged && form.apiKey) body.apiKey = form.apiKey
        await updateCredential(editing, body)
      }
      setEditing(null)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败') }
  }

  const remove = async (id: string) => {
    if (!confirm('确定删除这个凭证？')) return
    try { await deleteCredential(id); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '删除失败') }
  }

  const setDefault = async (id: string) => {
    try { await updateCredential(id, { isDefault: true }); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
  }

  return (
    <div className="j-overlay" onClick={onClose}>
      <div
        className="j-card"
        style={{ width: 520, maxHeight: '80vh', overflow: 'auto', padding: '28px 32px', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)' }}>API 凭证</h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}
          >×</button>
        </div>

        {error && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
        {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中…</div>}

        {/* 列表 */}
        {!editing && (
          <>
            {creds.length === 0 && !loading && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                当前使用平台默认凭证。添加自己的凭证后将优先使用。
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {creds.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-subtle)', border: '1px solid var(--border-light)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.label}
                    </span>
                    <span className="j-badge">{TIER_LABELS[c.tier] || c.tier}</span>
                    {c.isDefault && <span className="j-badge j-badge-accent">★ 默认</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 12 }}>
                    {!c.isDefault && (
                      <button
                        onClick={() => setDefault(c.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: '2px 6px', fontFamily: 'inherit' }}
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(c)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, padding: '2px 6px', fontFamily: 'inherit' }}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, padding: '2px 6px', fontFamily: 'inherit' }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={startNew}
              className="j-btn j-btn-ghost"
              style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}
            >
              + 添加凭证
            </button>
          </>
        )}

        {/* 表单 */}
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>名称</label>
              <input className="j-input" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="如 DeepSeek Pro" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>能力档位</label>
              <select
                className="j-input"
                style={{ cursor: 'pointer' }}
                value={form.tier}
                onChange={e => setForm({ ...form, tier: e.target.value })}
              >
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="strong">强力</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>API Key</label>
              {editing !== 'new' && !keyChanged ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>••••••••</span>
                  <button
                    onClick={() => setKeyChanged(true)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit' }}
                  >
                    更换
                  </button>
                </div>
              ) : (
                <input className="j-input" type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Base URL</label>
              <input className="j-input" value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="如 https://api.deepseek.com/anthropic" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>模型名</label>
              <input className="j-input" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-v4-flash" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
              设为默认凭证
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
              <button onClick={() => setEditing(null)} className="j-btn j-btn-ghost">取消</button>
              <button onClick={save} className="j-btn j-btn-primary">保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
