import { serverGet, serverPost, serverPut, serverDelete } from '../shared/server-client.js'

export interface Credential {
  id: string
  userId: string
  label: string
  tier: string
  baseUrl: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedCredential {
  apiKey: string
  baseUrl: string
  model: string
}

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

// 脱敏列表：绝不含 api_key（Java listSafeByUser 已裁掉 api_key_enc）
export async function listCredentials(userId: string): Promise<Credential[]> {
  return serverGet<Credential[]>(userId, '/api/credentials')
}

// 解密解析，仅后端内部使用。命中 Java 内部 resolve 端点（返回明文 apiKey）；
// 无可用凭证或解密失败时 Java 返回 404 → 这里降级为 null（回退平台默认 key），
// 与老 TS 的 console.warn + return null 语义一致（告警已挪到 Java 侧,不打印明文 key)。
export async function resolveCredential(userId: string, tier?: string): Promise<ResolvedCredential | null> {
  const query = tier ? `?tier=${encodeURIComponent(tier)}` : ''
  try {
    return await serverGet<ResolvedCredential>(userId, `/api/credentials/resolved${query}`)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function addCredential(userId: string, p: {
  label: string; tier: string; apiKey: string; baseUrl: string; model: string; isDefault?: boolean
}): Promise<Credential> {
  return serverPost<Credential>(userId, '/api/credentials', p)
}

export async function updateCredential(userId: string, id: string, p: {
  label?: string; tier?: string; apiKey?: string; baseUrl?: string; model?: string; isDefault?: boolean
}): Promise<Credential | null> {
  // Java 是 PUT /api/credentials/{id};缺失时抛 404 → 映射为 null(老 TS 的 rows[0] ? ... : null)。
  try {
    return await serverPut<Credential>(userId, `/api/credentials/${encodeURIComponent(id)}`, p)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  // Java DELETE 返回 {ok:true},缺失时抛 404 → 映射为 false(老 TS 的 boolean 语义)。
  try {
    const res = await serverDelete<{ ok: boolean }>(userId, `/api/credentials/${encodeURIComponent(id)}`)
    return res?.ok === true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}
