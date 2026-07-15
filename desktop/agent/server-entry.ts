/**
 * PG-free 智能层 server 入口(供 Electron 主进程 / 独立调试共用)。
 *
 * 与 `desktop/agent/index.ts` 的区别:
 *   - index.ts 是 CLI 独立入口:initDb(连 PG)→ syncSkillsHub → startJarvisServer → startCli
 *   - server-entry.ts 只做 syncSkillsHub + startJarvisServer,**不调 initDb**、**不起 CLI**
 *
 * 数据层已在 Plan C 全量改调 Java(见 shared/server-client.ts),不再直连 PostgreSQL,
 * 因此桌面/云端形态下建表(initDb)由 Java 负责,这里必须跳过。
 *
 * 用法:
 *   - Electron 主进程:child_process spawn `tsx desktop/agent/server-entry.ts`
 *   - 独立调试:`npx tsx desktop/agent/server-entry.ts`(需先起 Java 8080)
 */
import { startJarvisServer } from './jarvis/agent.js'
import { syncSkillsHub } from './jarvis/skills-hub.js'

export function startServerEntry() {
  const skills = syncSkillsHub()
  console.log(`[skills-hub] 已纳入 ${skills.length} 个 skill`)
  console.log(`[server-entry] PG-free 模式:跳过 initDb,数据代理到 Java (${process.env.JARVIS_SERVER_URL || 'http://localhost:8080'})`)
  return startJarvisServer()
}

// 直接以脚本方式运行时(tsx desktop/agent/server-entry.ts)自动启动。
// 被 import 时(如单测)不自动执行。
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server-entry.ts') ||
  process.argv[1].endsWith('server-entry.js')
)
if (isMain) {
  startServerEntry()
}
