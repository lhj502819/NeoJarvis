import { broadcast } from './sse.js'

type ShutdownHook = () => void | Promise<void>

const hooks: ShutdownHook[] = []
let shuttingDown = false

export function onShutdown(hook: ShutdownHook) {
  hooks.push(hook)
}

export async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[lifecycle] graceful shutdown started...')
  broadcast('progress', '系统正在重启，请稍后刷新页面...')

  for (const hook of hooks) {
    try { await hook() } catch (e) { console.error('[lifecycle] hook error:', e) }
  }

  console.log('[lifecycle] shutdown complete')
}

process.on('SIGTERM', () => { gracefulShutdown().then(() => process.exit(0)) })
process.on('SIGINT', () => { gracefulShutdown().then(() => process.exit(0)) })
