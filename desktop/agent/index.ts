import { startJarvisServer } from './jarvis/agent.js'
import { startCli } from './interface/cli.js'
import { syncSkillsHub } from './jarvis/skills-hub.js'

async function main() {
  const skills = syncSkillsHub()
  console.log(`[skills-hub] 已纳入 ${skills.length} 个 skill`)
  startJarvisServer()
  await new Promise(resolve => setTimeout(resolve, 300))
  await startCli()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
