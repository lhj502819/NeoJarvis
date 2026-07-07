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
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm p-8 bg-gray-900 rounded-2xl border border-gray-800">
        <div className="text-center mb-8">
          <img src="/jarvis-logo.png" alt="Jarvis" className="w-16 h-16 rounded-full object-cover mx-auto mb-3 border border-gray-700" />
          <h1 className="text-xl font-semibold text-white">Jarvis</h1>
          <p className="text-gray-400 text-sm mt-1">
            {isRegister ? '创建你的管家账号' : '欢迎回来，Sir'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            required
          />
          {isRegister && (
            <>
              <input
                type="text"
                placeholder="显示名称（可选）"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="邀请码"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                required
              />
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
          >
            {loading ? '...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-6">
          {isRegister ? '已有账号？' : '还没有账号？'}
          <button
            onClick={() => { setIsRegister(!isRegister); setError('') }}
            className="text-blue-400 hover:text-blue-300 ml-1"
          >
            {isRegister ? '去登录' : '注册'}
          </button>
        </p>
      </div>
    </div>
  )
}
