const BASE = ''

export interface AuthUser {
  userId: string
  username: string
  displayName?: string
}

export async function checkAuth(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: '登录失败' }))
    throw new Error(data.error || '登录失败')
  }
  return res.json()
}

export async function register(username: string, password: string, displayName: string, inviteCode: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password, displayName, inviteCode }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: '注册失败' }))
    throw new Error(data.error || '注册失败')
  }
  return res.json()
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
}
