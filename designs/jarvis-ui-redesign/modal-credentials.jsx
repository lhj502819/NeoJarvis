/* 凭证设置弹窗 */
function CredentialsModal({ open, onClose }) {
  const [creds] = React.useState([
    { id: '1', label: 'DeepSeek Pro', tier: 'strong', baseUrl: 'api.deepseek.com/anthropic', model: 'deepseek-v4-pro', isDefault: true },
    { id: '2', label: 'DeepSeek Flash', tier: 'fast', baseUrl: 'api.deepseek.com/anthropic', model: 'deepseek-v4-flash', isDefault: false },
  ]);
  const [editing, setEditing] = React.useState(null);

  const tierLabels = { fast: '快速', standard: '标准', strong: '强力' };

  if (!open) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" style={{ width: 480, maxHeight: '70vh', overflow: 'auto', padding: '28px 32px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600 }}>API 凭证</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {!editing && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {creds.map(c => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-subtle)', border: '1px solid var(--border-light)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.label}</span>
                    <span className="badge">{tierLabels[c.tier]}</span>
                    {c.isDefault && <span className="badge badge-accent">默认</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                    <button className="btn-text" style={{ fontSize: 12, padding: '2px 6px' }}>编辑</button>
                    <button className="btn-text" style={{ fontSize: 12, padding: '2px 6px', color: 'var(--red)' }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
              + 添加凭证
            </button>
          </>
        )}

        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>名称</label>
              <input className="input" placeholder="如 DeepSeek Pro" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>能力档位</label>
              <select className="input" style={{ cursor: 'pointer' }}>
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="strong">强力</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>API Key</label>
              <input className="input" type="password" placeholder="sk-..." />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Base URL</label>
              <input className="input" placeholder="如 https://api.deepseek.com/anthropic" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>模型名</label>
              <input className="input" placeholder="如 deepseek-v4-flash" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary">保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { CredentialsModal });
