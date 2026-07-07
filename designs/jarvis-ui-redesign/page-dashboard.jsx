/* 仪表盘 */
function DashboardPage() {
  const tasks = [
    { id: 1, name: '竞品定价调研', status: 'executing', subtasks: 3, done: 1, time: '2 分钟前' },
    { id: 2, name: '调研 TRD 创建的来源参数', status: 'completed', subtasks: 1, done: 1, time: '昨天' },
    { id: 3, name: '熟悉 claude-remote-service 项目', status: 'completed', subtasks: 1, done: 1, time: '2 天前' },
  ];
  const team = [
    { id: 1, name: 'uniops-server 开发专家', domain: 'DongDDD', tasks: 3, status: '待命' },
  ];

  const statusMap = { executing: { label: '进行中', cls: 'badge-green' }, completed: { label: '已完成', cls: '' }, failed: { label: '失败', cls: '' } };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000, margin: '0 auto' }}>
      <h1 className="text-display" style={{ fontSize: 24, marginBottom: 32, color: 'var(--text)' }}>仪表盘</h1>

      {/* 任务列表 */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>任务</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map(t => (
            <div key={t.id} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`badge ${statusMap[t.status]?.cls || ''}`}>{statusMap[t.status]?.label}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>{t.done}/{t.subtasks} 子任务</span>
                <span>{t.time}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 团队 */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>团队</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {team.map(a => (
            <div key={a.id} className="card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
                  {a.name[0]}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.domain}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{a.tasks} 次任务</span>
                <span>·</span>
                <span>{a.status}</span>
              </div>
            </div>
          ))}
          {/* 空位 */}
          <div className="card" style={{
            padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13,
          }}>
            执行任务后自动沉淀小弟
          </div>
        </div>
      </section>

      {/* 执行历史 */}
      <section>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>近期活动</h2>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
          <div>✓ 「调研 TRD 创建的来源参数」 完成 — 昨天</div>
          <div>✓ 「熟悉 claude-remote-service 项目」 完成 — 2 天前</div>
          <div>★ 「uniops-server 开发专家」 转正入编 — 3 天前</div>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { DashboardPage });
