import { useEffect, useState } from 'react'
import { listCredentials, createCredential, updateCredential, deleteCredential, type Credential } from '../api/credentials'

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
  // editing: null=不在编辑, 'new'=新增, 其它=编辑该 id
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [keyChanged, setKeyChanged] = useState(false)  // 编辑态是否点了"更换 key"

  const refresh = async () => {
    setLoading(true); setError('')
    try { setCreds(await listCredentials()) }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) { refresh(); setEditing(null) } }, [open])

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
        await createCredential(form)
      } else if (editing) {
        // 编辑：未点"更换"则不提交 apiKey
        const body: any = { label: form.label, tier: form.tier, baseUrl: form.baseUrl, model: form.model, isDefault: form.isDefault }
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

  const inputCls = 'w-full px-3 py-2 rounded bg-[#0c0c1a] border border-[#2a2a4a] text-white text-sm focus:border-[#7c7cff] outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] overflow-auto rounded-xl bg-[#12122a] border border-[#2a2a4a] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">API 凭证</h2>
          <button onClick={onClose} className="text-[#a0a0a0] hover:text-white text-xl leading-none">×</button>
        </div>

        {error && <div className="mb-3 text-sm text-[#e94560]">{error}</div>}
        {loading && <div className="text-sm text-[#a0a0a0]">加载中…</div>}

        {/* 列表 */}
        {!editing && (
          <>
            {creds.length === 0 && !loading && (
              <div className="text-sm text-[#a0a0a0] mb-4">当前使用平台默认凭证。添加自己的凭证后将优先使用。</div>
            )}
            <div className="space-y-2 mb-4">
              {creds.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded bg-[#0c0c1a] border border-[#2a2a4a]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white text-sm truncate">{c.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a4a] text-[#9e9eff]">{TIER_LABELS[c.tier] || c.tier}</span>
                    {c.isDefault && <span className="text-[10px] text-[#e94560]">★ 默认</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    {!c.isDefault && <button onClick={() => setDefault(c.id)} className="text-[#7c7cff] hover:text-[#9e9eff]">设为默认</button>}
                    <button onClick={() => startEdit(c)} className="text-[#a0a0a0] hover:text-white">编辑</button>
                    <button onClick={() => remove(c.id)} className="text-[#a0a0a0] hover:text-[#e94560]">删除</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={startNew} className="w-full py-2 rounded border border-dashed border-[#2a2a4a] text-sm text-[#7c7cff] hover:border-[#7c7cff]">+ 添加凭证</button>
          </>
        )}

        {/* 新增/编辑表单 */}
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">名称</label>
              <input className={inputCls} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="如 DeepSeek Pro" />
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">能力档位</label>
              <select className={inputCls} value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="strong">强力</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">API Key</label>
              {editing !== 'new' && !keyChanged ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#a0a0a0]">••••••••</span>
                  <button onClick={() => setKeyChanged(true)} className="text-xs text-[#7c7cff]">更换</button>
                </div>
              ) : (
                <input className={inputCls} type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
              )}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Base URL</label>
              <input className={inputCls} value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="如 https://api.deepseek.com/anthropic" />
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">模型名</label>
              <input className={inputCls} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-v4-flash" />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#a0a0a0]">
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} />
              设为默认凭证
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded text-sm text-[#a0a0a0] hover:text-white">取消</button>
              <button onClick={save} className="px-4 py-2 rounded bg-[#7c7cff] text-white text-sm hover:bg-[#9e9eff]">保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
