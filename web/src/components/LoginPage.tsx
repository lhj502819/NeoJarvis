import { useState } from 'react'
import { login, register } from '../api/auth'

interface LoginPageProps {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isRegister) {
        await register(username, password, displayName || username, inviteCode)
      } else {
        await login(username, password)
      }
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="j-card" style={{ width: 380, padding: '48px 40px', textAlign: 'center' }}>
        <img
          src="/jarvis-logo.png"
          alt="Jarvis"
          style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)', display: 'block', margin: '0 auto' }}
        />
        <h1 className="text-display" style={{ fontSize: 28, marginTop: 20, marginBottom: 4, color: 'var(--text)' }}>
          Jarvis
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
          {isRegister ? '创建你的管家账号' : '欢迎回来，Sir'}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="j-input"
            type="text"
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
          <input
            className="j-input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {isRegister && (
            <>
              <input
                className="j-input"
                type="text"
                placeholder="显示名称（可选）"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
              <input
                className="j-input"
                type="text"
                placeholder="邀请码"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                required
              />
            </>
          )}

          {error && <p style={{ fontSize: 13, color: 'var(--red)', textAlign: 'left', marginTop: 4 }}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="j-btn j-btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '12px 16px' }}
          >
            {loading ? '...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 24 }}>
          {isRegister ? '已有账号？' : '还没有账号？'}
          <button
            type="button"
            onClick={() => { setIsRegister(!isRegister); setError('') }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', marginLeft: 4, fontFamily: 'inherit', fontSize: 12 }}
          >
            {isRegister ? '去登录' : '注册'}
          </button>
        </p>
      </div>
    </div>
  )
}
