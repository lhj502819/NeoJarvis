/**
 * HTTP client for the v0.3 Java data server (port 8080).
 *
 * The old TS data layer talked to PostgreSQL directly via `pool.query`. In v0.3 the
 * intelligence layer (this `src/` tree) no longer owns the DB — it calls the Java
 * server's REST API, which persists to MySQL.
 *
 * Every TS data-layer function receives a `userId`. There is no cookie/JWT on these
 * internal calls, so we forward the user via the `X-Internal-User` header. The Java
 * `JwtAuthFilter` trusts this header only when dev-bypass is on (single-machine mode).
 *
 * Failure semantics mirror the old `pool.query` behaviour: any non-2xx response throws,
 * so callers keep the same "reject on DB error" contract without changing signatures.
 */

const BASE_URL = process.env.JARVIS_SERVER_URL || 'http://localhost:8080'

const INTERNAL_USER_HEADER = 'X-Internal-User'

async function request<T>(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      [INTERNAL_USER_HEADER]: userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `server ${method} ${path} -> ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
    )
  }

  // Tolerate empty bodies (e.g. 204 No Content) — return undefined rather than throwing on JSON.parse.
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function serverGet<T>(userId: string, path: string): Promise<T> {
  return request<T>(userId, 'GET', path)
}

export function serverPost<T>(userId: string, path: string, body?: unknown): Promise<T> {
  return request<T>(userId, 'POST', path, body)
}

export function serverPatch<T>(userId: string, path: string, body?: unknown): Promise<T> {
  return request<T>(userId, 'PATCH', path, body)
}

export function serverDelete<T>(userId: string, path: string): Promise<T> {
  return request<T>(userId, 'DELETE', path)
}
