import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

// 所有用户临时文件沙盒的根：~/.jarvis/workspaces/
const WORKSPACES_ROOT = join(homedir(), '.jarvis', 'workspaces')

// userId 只允许 UUID / 'system' 这类安全字符，杜绝 ../ 之类的路径注入
const SAFE_ID = /^[a-zA-Z0-9_-]+$/

/**
 * 返回该用户的临时文件沙盒目录：~/.jarvis/workspaces/{userId}/
 * 不存在则递归创建。作为调研/生活类等无明确项目 cwd 的任务的默认工作目录，
 * 避免临时产物（预览 html、中间草稿等）污染用户项目目录。
 */
export function getUserWorkspace(userId: string): string {
  if (!userId || !SAFE_ID.test(userId)) {
    throw new Error(`非法 userId，拒绝创建工作区：${JSON.stringify(userId)}`)
  }

  const dir = join(WORKSPACES_ROOT, userId)

  // 双重防护：解析后的路径必须仍在 WORKSPACES_ROOT 之内
  const resolved = resolve(dir)
  if (resolved !== resolve(WORKSPACES_ROOT, userId)) {
    throw new Error(`工作区路径越界，拒绝创建：${resolved}`)
  }

  mkdirSync(resolved, { recursive: true })
  return resolved
}
