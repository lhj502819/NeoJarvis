import { randomUUID, scryptSync, randomBytes } from 'crypto'
import db from '../shared/db.js'

export interface User {
  id: string
  username: string
  displayName: string
  passwordHash: string
  salt: string
  role: 'admin' | 'user'
  createdAt: string
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    salt: row.salt,
    role: row.role,
    createdAt: row.created_at,
  }
}

export function createUser(username: string, displayName: string, password: string): User {
  const existing = db.prepare('SELECT id FROM jarvis_users WHERE username = ?').get(username)
  if (existing) throw new Error('用户名已存在')

  const count = (db.prepare('SELECT COUNT(*) as cnt FROM jarvis_users').get() as any).cnt
  const salt = randomBytes(16).toString('hex')
  const role = count === 0 ? 'admin' : 'user'
  const user: User = {
    id: randomUUID(),
    username,
    displayName,
    passwordHash: hashPassword(password, salt),
    salt,
    role,
    createdAt: new Date().toISOString(),
  }

  db.prepare(`
    INSERT INTO jarvis_users (id, username, display_name, password_hash, salt, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, user.displayName, user.passwordHash, user.salt, user.role, user.createdAt)

  return user
}

export function findUserByUsername(username: string): User | undefined {
  const row = db.prepare('SELECT * FROM jarvis_users WHERE username = ?').get(username) as any
  return row ? rowToUser(row) : undefined
}

export function findUserById(userId: string): User | undefined {
  const row = db.prepare('SELECT * FROM jarvis_users WHERE id = ?').get(userId) as any
  return row ? rowToUser(row) : undefined
}

export function validatePassword(user: User, password: string): boolean {
  return hashPassword(password, user.salt) === user.passwordHash
}

export function listUsers(): Omit<User, 'passwordHash' | 'salt'>[] {
  const rows = db.prepare('SELECT id, username, display_name, role, created_at FROM jarvis_users').all() as any[]
  return rows.map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  }))
}

export function deleteUser(userId: string): boolean {
  const row = db.prepare('SELECT role FROM jarvis_users WHERE id = ?').get(userId) as any
  if (!row) return false
  if (row.role === 'admin') throw new Error('不能删除管理员')
  db.prepare('DELETE FROM jarvis_users WHERE id = ?').run(userId)
  return true
}

export function isAdmin(userId: string): boolean {
  const row = db.prepare('SELECT role FROM jarvis_users WHERE id = ?').get(userId) as any
  return row?.role === 'admin'
}
