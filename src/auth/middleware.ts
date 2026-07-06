import type { Request, Response, NextFunction } from 'express'
import { verifyToken, type TokenPayload } from './auth.js'
import { cleanupStaleTasks } from '../task/manager.js'

declare global {
  namespace Express {
    interface Request {
      userId?: string
      username?: string
    }
  }
}

const initializedUsers = new Set<string>()

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.jarvis_token
  if (!token) {
    res.status(401).json({ error: 'not authenticated' })
    return
  }

  const payload = verifyToken(token)
  if (!payload) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  req.userId = payload.userId
  req.username = payload.username

  if (!initializedUsers.has(payload.userId)) {
    initializedUsers.add(payload.userId)
    cleanupStaleTasks(payload.userId)
  }

  next()
}
