import { initDb } from './shared/db.js'
import { startJarvisServer } from './jarvis/agent.js'
import { startCli } from './interface/cli.js'

async function main() {
  await initDb()
  startJarvisServer()
  await new Promise(resolve => setTimeout(resolve, 300))
  await startCli()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
