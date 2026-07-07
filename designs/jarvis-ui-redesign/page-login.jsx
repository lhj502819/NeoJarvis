/* 登录页 — 管家笔记本封面 */
function LoginPage({ onLogin }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

  const handleSubmit = (e) => { e.preventDefault(); if (username && password) onLogin(username); };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div className="card" style={{ width: 380, padding: '48px 40px', textAlign: 'center' }}>
        <JarvisAvatar size={72} />
        <h1 className="text-display" style={{ fontSize: 28, marginTop: 20, marginBottom: 4, color: 'var(--text)' }}>
          Jarvis
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
          欢迎回来，Sir
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="input" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px 16px' }}>
            登录
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 24 }}>
          还没有账号？ <span style={{ color: 'var(--accent)', cursor: 'pointer' }}>注册</span>
        </p>
      </div>
    </div>
  );
}

Object.assign(window, { LoginPage });
