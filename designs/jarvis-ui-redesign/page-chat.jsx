/* 聊天主界面 */
function ChatPage() {
  const [messages, setMessages] = React.useState([
    { id: 1, role: 'jarvis', content: '收到，Sir。团队目前 1 位在编小弟——「uniops-server 开发专家」，状态待命。有什么需要我安排的？' },
    { id: 2, role: 'user', content: '帮我调研一下竞品的定价策略' },
    { id: 3, role: 'jarvis', content: '明白。我来拆解一下这个任务：\n\n1. **搜索竞品列表** → 分配给「调研专家」\n2. **各家定价详情** → 分配给「数据采集员」\n3. **结构化整理** → 分配给「文档整理」\n\n3 个子任务已并行启动，预计 3-5 分钟出结果。有进展我会通知您。' },
  ]);
  const [input, setInput] = React.useState('');

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)' }}>
      {/* 主聊天区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        {/* 消息列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <JarvisAvatar size={64} />
              <p style={{ marginTop: 16, fontSize: 16 }}>你好，Sir。有什么我能帮忙的？</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>随时吩咐，我在。</p>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ display: 'flex', gap: 12, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  {msg.role === 'jarvis' && <JarvisAvatar size={28} />}
                  <div style={{
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-subtle)',
                    color: msg.role === 'user' ? 'var(--text-on-accent)' : 'var(--text)',
                    fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600, flexShrink: 0,
                    }}>S</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 输入区 */}
        <div style={{ padding: '16px 32px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input
              className="input"
              placeholder="跟 Jarvis 说点什么..."
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{ flex: 1, borderRadius: 'var(--radius)' }}
            />
            <button className="btn btn-primary" style={{ padding: '10px 16px', borderRadius: 'var(--radius)' }}>
              发送
            </button>
          </div>
        </div>
      </div>

      {/* 右侧栏 */}
      <aside style={{ width: 280, overflow: 'auto', padding: '20px 16px', background: 'var(--bg)' }}>
        {/* 任务 */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>任务</h3>
          <div className="card" style={{ padding: '10px 12px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-green" style={{ fontSize: 10 }}>进行中</span>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>竞品定价调研</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>3/3 子任务执行中</div>
          </div>
        </div>

        <hr className="divider" />

        {/* 团队 */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>团队 (1)</h3>
          <div className="card" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>uniops-server 开发专家</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>待命 · 累计 3 次任务</div>
          </div>
        </div>

        <hr className="divider" />

        {/* Jarvis 状态 */}
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>Jarvis 状态</h3>
          {[
            { label: '精力', value: 85, color: 'var(--green)' },
            { label: '心情', value: 92, color: 'var(--accent)' },
            { label: '信任度', value: 60, color: 'var(--yellow)' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 40 }}>{s.label}</span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-hover)' }}>
                <div style={{ width: `${s.value}%`, height: '100%', borderRadius: 2, background: s.color }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 24, textAlign: 'right' }}>{s.value}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, { ChatPage });
