import jwt from 'jsonwebtoken'
import { Router } from 'express'
import { createUser, findUserByUsername, findUserById, validatePassword, listUsers, deleteUser, isAdmin } from './users.js'

const JWT_SECRET = process.env.JWT_SECRET || 'jarvis-dev-secret-change-in-prod'
const INVITE_CODE = process.env.INVITE_CODE || ''
let currentInviteCode = INVITE_CODE
const TOKEN_EXPIRY = '30d'
const COOKIE_NAME = 'jarvis_token'

export interface TokenPayload {
  userId: string
  username: string
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

function setTokenCookie(res: any, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

function ok(data: Record<string, unknown>) {
  return { code: 0, ...data }
}

function fail(code: number, message: string) {
  return { code, message }
}

export function authRouter(): Router {
  const router = Router()

  router.post('/auth/register', async (req, res) => {
    const { username, displayName, password, inviteCode } = req.body

    if (!username || !password) {
      res.status(400).json(fail(400, '用户名和密码不能为空'))
      return
    }

    if (currentInviteCode && inviteCode !== currentInviteCode) {
      res.status(403).json(fail(403, '邀请码无效'))
      return
    }

    try {
      const user = await createUser(username, displayName || username, password)
      const token = signToken({ userId: user.id, username: user.username })
      setTokenCookie(res, token)
      res.json(ok({ userId: user.id, username: user.username, displayName: user.displayName }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '注册失败'
      res.status(400).json(fail(400, msg))
    }
  })

  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json(fail(400, '用户名和密码不能为空'))
      return
    }

    const user = await findUserByUsername(username)
    if (!user || !validatePassword(user, password)) {
      res.status(401).json(fail(401, '用户名或密码错误'))
      return
    }

    const token = signToken({ userId: user.id, username: user.username })
    setTokenCookie(res, token)
    res.json(ok({ userId: user.id, username: user.username, displayName: user.displayName }))
  })

  router.get('/auth/me', async (req, res) => {
    const token = req.cookies?.jarvis_token
    if (!token) {
      res.status(401).json(fail(401, '未登录'))
      return
    }

    const payload = verifyToken(token)
    if (!payload) {
      res.status(401).json(fail(401, 'token 无效'))
      return
    }

    const user = await findUserById(payload.userId)
    res.json(ok({ userId: payload.userId, username: payload.username, role: user?.role || 'user' }))
  })

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' })
    res.json(ok({}))
  })

  // ─── Admin routes ───

  async function requireAdmin(req: any, res: any, next: any) {
    const token = req.cookies?.jarvis_token
    if (!token) { res.status(401).json(fail(401, '未登录')); return }
    const payload = verifyToken(token)
    if (!payload || !await isAdmin(payload.userId)) {
      res.status(403).json(fail(403, '需要管理员权限'))
      return
    }
    next()
  }

  router.get('/admin/users', requireAdmin, async (_req, res) => {
    res.json(ok({ users: await listUsers() }))
  })

  router.delete('/admin/users/:userId', requireAdmin, async (req, res) => {
    try {
      const deleted = await deleteUser(req.params.userId)
      if (!deleted) { res.status(404).json(fail(404, '用户不存在')); return }
      res.json(ok({}))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败'
      res.status(400).json(fail(400, msg))
    }
  })

  router.get('/admin/invite-code', requireAdmin, (_req, res) => {
    res.json(ok({ inviteCode: INVITE_CODE || '(未设置，任何人可注册)' }))
  })

  router.put('/admin/invite-code', requireAdmin, (req, res) => {
    const { code } = req.body
    if (typeof code !== 'string') {
      res.status(400).json(fail(400, 'code 字段必须是字符串'))
      return
    }
    currentInviteCode = code
    res.json(ok({ inviteCode: currentInviteCode || '(已关闭邀请码)' }))
  })

  return router
}
