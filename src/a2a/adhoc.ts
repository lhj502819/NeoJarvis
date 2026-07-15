import type { AdhocAgent } from '../shared/types.js'
import { serverGet, serverPost } from '../shared/server-client.js'

/**
 * v0.3: the adhoc-agent data layer no longer touches PostgreSQL directly — it calls the
 * Java server's AdhocController. The Java AdhocAgent record is field-for-field identical
 * to the TS type (camelCase JSON), so responses deserialize directly with no row mapping.
 *
 * The three load-bearing rules that used to live here — topic merge (dedup, cap 20), the
 * promoted guard (no accumulation once promoted), and dropping `auto-` fallback session
 * ids to NULL — are all done server-side now (AdhocService). The TS layer just forwards
 * params. The one guard we keep client-side is the empty-domain no-op: an empty domain has
 * nothing to aggregate on and the Java endpoint (@NotBlank) would reject it with a 400,
 * so we short-circuit before the call to preserve the old silent-skip behaviour.
 *
 * Signatures and return types are unchanged from the old pool-based version.
 */

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

export async function upsertAdhocAgent(userId: string, params: {
  domain: string
  taskDescription: string
  cwd?: string
  sessionId?: string
  topics: string[]
}): Promise<void> {
  if (!params.domain) return  // 无领域标签,无法聚合/晋升(避免 Java @NotBlank 400)
  // Java 做 upsert + topic 合并/去重截 20 + promoted 守卫 + auto- sessionId 归 null,直接透传。
  await serverPost<AdhocAgent>(userId, '/api/adhoc', params)
}

export async function getAdhocAgent(userId: string, domain: string): Promise<AdhocAgent | undefined> {
  try {
    return await serverGet<AdhocAgent>(userId, `/api/adhoc/${encodeURIComponent(domain)}`)
  } catch (err) {
    if (isNotFound(err)) return undefined  // 该 domain 无聚合(mirrors old `rows[0] ? ... : undefined`)
    throw err
  }
}

export async function listAdhocAgents(userId: string): Promise<AdhocAgent[]> {
  // GET /api/adhoc 已按 promoted=0 过滤 + task_count DESC 排序(同老 SQL)。
  return serverGet<AdhocAgent[]>(userId, '/api/adhoc')
}

export async function markAdhocPromoted(userId: string, domain: string): Promise<void> {
  await serverPost(userId, `/api/adhoc/${encodeURIComponent(domain)}/promoted`)
}
