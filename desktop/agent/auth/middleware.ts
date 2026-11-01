import type { Request, Response, NextFunction } from 'express'
import { verifyToken, type TokenPayload } from './auth.js'
import { recoverInterruptedTasks } from '../jarvis/action-dispatcher.js'

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
    res.status(401).json({ code: 401, message: '未登录' })
    return
  }

  const payload = verifyToken(token)
  if (!payload) {
    res.status(401).json({ code: 401, message: 'token 无效' })
    return
  }

  req.userId = payload.userId
  req.username = payload.username

  if (!initializedUsers.has(payload.userId)) {
    initializedUsers.add(payload.userId)
    // 进程启动后该用户首个请求:先跑重启恢复(区分"小弟真跑完只是没结算"vs"真被打断"),
    // 它内部会兜底调 cleanupStaleTasks。fire-and-forget —— 里面可能调 LLM 补汇报,不能阻塞本请求。
    recoverInterruptedTasks(payload.userId).catch(() => {})
  }

  next()
}
