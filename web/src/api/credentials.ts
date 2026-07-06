const BASE = ''

export interface Credential {
  id: string
  label: string
  tier: 'fast' | 'standard' | 'strong'
  baseUrl: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CredentialInput {
  label: string
  tier: string
  apiKey?: string
  baseUrl: string
  model: string
  isDefault?: boolean
}

export async function listCredentials(): Promise<Credential[]> {
  const res = await fetch(`${BASE}/api/credentials`, { credentials: 'include' })
  if (!res.ok) throw new Error('获取凭证失败')
  return res.json()
}

export async function createCredential(body: CredentialInput): Promise<Credential> {
  const res = await fetch(`${BASE}/api/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({ error: '创建失败' }))
    throw new Error(d.error || '创建失败')
  }
  return res.json()
}

export async function updateCredential(id: string, body: Partial<CredentialInput>): Promise<Credential> {
  const res = await fetch(`${BASE}/api/credentials/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({ error: '更新失败' }))
    throw new Error(d.error || '更新失败')
  }
  return res.json()
}

export async function deleteCredential(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/credentials/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('删除失败')
}
