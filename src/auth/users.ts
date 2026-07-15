import { pbkdf2Sync } from 'crypto'
import { serverGet, serverPost, serverDelete } from '../shared/server-client.js'

/**
 * v0.3: the user data layer no longer touches PostgreSQL — it calls the Java server's
 * internal user endpoints (InternalUserController, /api/internal/users). Java owns id
 * generation, the "first user is admin" rule, duplicate-username rejection and the actual
 * password hashing (see UserService / PasswordHasher). Signatures and return types are
 * unchanged from the old pool-based version so auth.ts keeps compiling untouched.
 *
 * These functions have no userId in their signature (they are the auth layer, which runs
 * before a user is resolved), so they forward a 'local' placeholder as X-Internal-User —
 * the dev-bypass filter accepts any value. The internal endpoints deliberately have no
 * invite-code / admin gating; that policy stays in auth.ts, exactly where it was.
 *
 * validatePassword must stay a *synchronous* boolean check (auth.ts calls it inline), so it
 * cannot round-trip to Java. Instead findUser* return the full row (incl. passwordHash +
 * salt) and we re-derive the hash locally. Java hashes with PBKDF2-HMAC-SHA256, 210k
 * iterations, 64-byte key, salt fed as its UTF-8 bytes (PasswordHasher.java) — replicated
 * byte-for-byte below (both sides UTF-8-encode the password, so ASCII + Unicode match).
 */

const INTERNAL_USER = 'local'
const PBKDF2_ITERATIONS = 210_000
const PBKDF2_KEYLEN = 64
const PBKDF2_DIGEST = 'sha256'

export interface User {
  id: string
  username: string
  displayName: string
  passwordHash: string
  salt: string
  role: 'admin' | 'user'
  createdAt: string
}

/** Java UserRow serializes camelCase, field-for-field identical to User — deserializes directly. */
function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, Buffer.from(salt, 'utf8'), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex')
}

/** Java 404 (NotFoundException) — server-client throws with the status in the message. */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && / -> 404\b/.test(err.message)
}

export async function createUser(username: string, displayName: string, password: string): Promise<User> {
  // Mirror the old two-step behaviour: reject duplicates with a clean message before creating.
  // (Java also guards this, but the pre-check keeps the exact "用户名已存在" error auth.ts expects.)
  const existing = await findUserByUsername(username)
  if (existing) throw new Error('用户名已存在')
  return serverPost<User>(INTERNAL_USER, '/api/internal/users', { username, displayName, password })
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  try {
    return await serverGet<User>(INTERNAL_USER, `/api/internal/users/by-username?username=${encodeURIComponent(username)}`)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

export async function findUserById(userId: string): Promise<User | undefined> {
  try {
    return await serverGet<User>(INTERNAL_USER, `/api/internal/users/${encodeURIComponent(userId)}`)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

export function validatePassword(user: User, password: string): boolean {
  return hashPassword(password, user.salt) === user.passwordHash
}

export async function listUsers(): Promise<Omit<User, 'passwordHash' | 'salt'>[]> {
  // Java returns the redacted User view {id, username, displayName, role, createdAt}.
  return serverGet<Omit<User, 'passwordHash' | 'salt'>[]>(INTERNAL_USER, '/api/internal/users')
}

export async function deleteUser(userId: string): Promise<boolean> {
  // Mirror the old logic: missing -> false, admin -> throw '不能删除管理员'. Checking the role
  // here (rather than parsing Java's error body) preserves the exact clean message auth.ts uses.
  const user = await findUserById(userId)
  if (!user) return false
  if (user.role === 'admin') throw new Error('不能删除管理员')
  await serverDelete(INTERNAL_USER, `/api/internal/users/${encodeURIComponent(userId)}`)
  return true
}

export async function isAdmin(userId: string): Promise<boolean> {
  const user = await findUserById(userId)
  return user?.role === 'admin'
}
