import { promises as fs } from 'node:fs'
import { serverGet } from './server-client.js'

/**
 * v0.3 artifact storage moved off DB TEXT and onto per-user files under
 * `~/.jarvis/artifacts/{userId}/{artifactId}.{ext}`. The Java server now returns EITHER
 *   - `content` (legacy row, pre-migration — DB still has the body), OR
 *   - `uri`     (new row — `file://` pointer to the local file)
 * ...never both. This helper is the intelligence layer's single adapter so callers
 * (tools.ts pin/update, brain.ts pinned context) don't have to branch on the shape.
 *
 * The agent process is Node with unrestricted fs access, so we read the `file://` URI
 * directly — no IPC needed. Front-end code has its own adapter (Electron IPC / HTTP).
 */

/** Shape returned by the Java server for GET /api/artifact/{id} (v0.3). */
export interface ArtifactRecord {
  id: string
  type: string
  title: string
  content?: string
  uri?: string
  language?: string
  version: number
}

/**
 * Fetch an artifact and materialise its content string.
 *
 * Precedence: `content` (legacy) → `uri` (file read) → throw. Callers get a plain string
 * regardless of storage backend, so pin_artifact / update_artifact / brain.ts pinned
 * context all keep their original semantics.
 *
 * Throws when neither field is populated (should never happen for a valid row) — treat
 * this as a data-integrity error, not a "missing artifact" (that surfaces as HTTP 404
 * from serverGet, which callers already handle via {@code isNotFound}).
 */
export async function getArtifactContent(userId: string, id: string): Promise<{ record: ArtifactRecord; content: string }> {
  const record = await serverGet<ArtifactRecord>(userId, `/api/artifact/${encodeURIComponent(id)}`)
  const content = await materialise(record)
  return { record, content }
}

/**
 * Extract content from an already-fetched record. Split out so callers with a record in
 * hand (e.g. after a PATCH that echoes the refreshed artifact) don't have to re-fetch.
 */
export async function materialise(record: ArtifactRecord): Promise<string> {
  if (typeof record.content === 'string' && record.content.length > 0) {
    return record.content
  }
  if (record.uri) {
    const uri = record.uri
    // Node side: only file:// is expected (Java always returns file:// today). If OSS
    // ships later returning https://, we'd fetch here — kept out of scope for now to
    // avoid pulling network into the agent path unexpectedly.
    if (uri.startsWith('file://')) {
      const path = uri.slice('file://'.length)
      return await fs.readFile(path, 'utf-8')
    }
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const res = await fetch(uri)
      if (!res.ok) throw new Error(`fetch artifact uri ${uri} -> ${res.status}`)
      return await res.text()
    }
    throw new Error(`unsupported artifact uri scheme: ${uri}`)
  }
  throw new Error(`artifact ${record.id} has neither content nor uri`)
}
