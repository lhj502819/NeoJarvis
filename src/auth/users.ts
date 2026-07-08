import { randomUUID, scryptSync, randomBytes } from 'crypto'
import pool from '../shared/db.js'

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

export async function createUser(username: string, displayName: string, password: string): Promise<User> {
  const { rows: existing } = await pool.query('SELECT id FROM jarvis_users WHERE username = $1', [username])
  if (existing.length > 0) throw new Error('用户名已存在')

  const { rows: countRows } = await pool.query('SELECT COUNT(*) as cnt FROM jarvis_users')
  const count = parseInt(countRows[0].cnt, 10)
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

  await pool.query(
    `INSERT INTO jarvis_users (id, username, display_name, password_hash, salt, role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [user.id, user.username, user.displayName, user.passwordHash, user.salt, user.role, user.createdAt]
  )

  return user
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_users WHERE username = $1', [username])
  return rows[0] ? rowToUser(rows[0]) : undefined
}

export async function findUserById(userId: string): Promise<User | undefined> {
  const { rows } = await pool.query('SELECT * FROM jarvis_users WHERE id = $1', [userId])
  return rows[0] ? rowToUser(rows[0]) : undefined
}

export function validatePassword(user: User, password: string): boolean {
  return hashPassword(password, user.salt) === user.passwordHash
}

export async function listUsers(): Promise<Omit<User, 'passwordHash' | 'salt'>[]> {
  const { rows } = await pool.query('SELECT id, username, display_name, role, created_at FROM jarvis_users')
  return rows.map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  }))
}

export async function deleteUser(userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT role FROM jarvis_users WHERE id = $1', [userId])
  if (rows.length === 0) return false
  if (rows[0].role === 'admin') throw new Error('不能删除管理员')
  await pool.query('DELETE FROM jarvis_users WHERE id = $1', [userId])
  return true
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT role FROM jarvis_users WHERE id = $1', [userId])
  return rows[0]?.role === 'admin'
}
