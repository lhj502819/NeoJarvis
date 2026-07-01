import { startJarvisServer } from './jarvis/agent.js'
import { config } from './shared/config.js'
import { cleanupStaleTasks } from './task/manager.js'

const API = `http://localhost:${config.jarvisPort}`

// ─── 测试框架 ───

interface TestResult {
  case: string
  name: string
  passed: boolean
  detail: string
  duration: number
}

const results: TestResult[] = []
const allBackgroundEvents: Array<{ type: string; content: string }> = []
let eventsController: AbortController | null = null

function assert(caseName: string, name: string, condition: boolean, detail: string, startTime: number) {
  results.push({ case: caseName, name, passed: condition, detail, duration: Date.now() - startTime })
}

async function sendChat(message: string): Promise<{ events: Array<{ type: string; content: string }>; fullResponse: string }> {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: Array<{ type: string; content: string }> = []
  let fullResponse = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const event = JSON.parse(line.slice(6))
        events.push(event)
        if (event.type === 'response') fullResponse = event.content
      } catch {}
    }
  }

  return { events, fullResponse }
}

async function getTaskSummary(): Promise<string> {
  const res = await fetch(`${API}/tasks`)
  const data = await res.json()
  return data.summary
}

function startGlobalEventListener() {
  eventsController = new AbortController()
  ;(async () => {
    try {
      const res = await fetch(`${API}/events`, { signal: eventsController.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type !== 'connected') allBackgroundEvents.push(event)
          } catch {}
        }
      }
    } catch {}
  })()
}

function stopGlobalEventListener() {
  eventsController?.abort()
}

// ─── 测试场景 ───

// 场景 1: 基本对话 — 简单问题直接回答，不创建任务
async function testSimpleChat() {
  const CASE = '基本对话'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 简单问题应直接回答，不创建任务\x1b[0m`)

  const tasksBefore = await getTaskSummary()
  const { fullResponse, events } = await sendChat('TypeScript 和 JavaScript 有什么区别？简单说')

  assert(CASE, '有回复内容', fullResponse.length > 20, fullResponse.slice(0, 60), start)
  assert(CASE, '回复涉及问题', fullResponse.includes('类型') || fullResponse.includes('Type') || fullResponse.includes('静态'), fullResponse.slice(0, 60), start)

  const tasksAfter = await getTaskSummary()
  assert(CASE, '没有创建任务', tasksBefore === tasksAfter, '任务列表未变化', start)
  assert(CASE, '响应时间<30s', Date.now() - start < 30000, `${Date.now() - start}ms`, start)

  console.log(`  ✓ 回复: ${fullResponse.slice(0, 80)}...`)
}

// 场景 2: 任务分配 — 需要执行的任务应创建 Task 并立即返回计划
async function testTaskAssignment() {
  const CASE = '任务分配'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 分配调研任务，Jarvis 应创建任务并立即返回计划\x1b[0m`)

  const { fullResponse } = await sendChat('帮我调研一下 Bun 和 Deno 这两个 JS 运行时的优缺点对比')

  assert(CASE, 'Jarvis 立即回复', fullResponse.length > 10, fullResponse.slice(0, 60), start)
  assert(CASE, '回复包含计划', fullResponse.includes('任务') || fullResponse.includes('计划') || fullResponse.includes('执行'), fullResponse.slice(0, 80), start)
  assert(CASE, '响应时间<30s（非阻塞）', Date.now() - start < 30000, `${Date.now() - start}ms`, start)

  const tasks = await getTaskSummary()
  assert(CASE, '任务已创建到系统', !tasks.includes('没有任何任务'), tasks.slice(0, 80), start)

  console.log(`  ✓ 回复: ${fullResponse.slice(0, 80)}...`)
}

// 场景 3: 查询进展 — 任务执行中询问进度
async function testQueryProgress() {
  const CASE = '查询进展'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 任务执行中，询问进展\x1b[0m`)

  await new Promise(resolve => setTimeout(resolve, 3000))
  const { fullResponse } = await sendChat('刚才那个调研任务进展怎么样了？')

  assert(CASE, '有实质回复', fullResponse.length > 15, fullResponse.slice(0, 60), start)
  assert(CASE, '回复涉及状态', fullResponse.includes('执行') || fullResponse.includes('进') || fullResponse.includes('running') || fullResponse.includes('正在'), fullResponse.slice(0, 80), start)

  console.log(`  ✓ 回复: ${fullResponse.slice(0, 80)}...`)
}

// 场景 4: 实时打断 — 任务执行中发新消息，应能同时处理
async function testInterrupt() {
  const CASE = '实时打断'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 任务执行中发新消息，两条应都能得到回复\x1b[0m`)

  const promise1 = sendChat('帮我搜一下最近有什么好看的科幻电影')
  await new Promise(resolve => setTimeout(resolve, 1500))
  const { fullResponse: interruptResponse } = await sendChat('之前的调研做完了吗？')

  assert(CASE, '打断消息有回复', interruptResponse.length > 10, interruptResponse.slice(0, 60), start)

  const { fullResponse: firstResponse } = await promise1
  assert(CASE, '原消息也有回复', firstResponse.length > 5, firstResponse.slice(0, 60), start)

  console.log(`  ✓ 打断回复: ${interruptResponse.slice(0, 60)}...`)
}

// 场景 5: 后台事件推送 — 任务执行期间应有进度事件
async function testBackgroundEvents() {
  const CASE = '后台事件'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 后台任务执行期间应有进度事件推送\x1b[0m`)

  await new Promise(resolve => setTimeout(resolve, 15000))

  const progressEvents = allBackgroundEvents.filter(e => e.type === 'progress')
  assert(CASE, '收到进度事件', progressEvents.length > 0, `${progressEvents.length} 个`, start)

  if (progressEvents.length > 0) {
    assert(CASE, '进度内容有意义', progressEvents[0].content.length > 5, progressEvents[0].content.slice(0, 60), start)
  } else {
    assert(CASE, '进度内容有意义', false, '无事件', start)
  }

  console.log(`  ✓ 累计 ${allBackgroundEvents.length} 个后台事件`)
}

// 场景 6: 取消任务 — 用户说"停止"应真正取消任务
async function testCancelTask() {
  const CASE = '取消任务'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 用户说"停止所有任务"应真正取消\x1b[0m`)

  const { fullResponse } = await sendChat('把所有任务都停掉')

  assert(CASE, '确认取消', fullResponse.includes('取消') || fullResponse.includes('停') || fullResponse.includes('cancel'), fullResponse.slice(0, 60), start)

  const tasks = await getTaskSummary()
  const hasActive = tasks.includes('executing') || tasks.includes('planning')
  assert(CASE, '无活跃任务', !hasActive, tasks.slice(0, 80), start)

  console.log(`  ✓ 回复: ${fullResponse.slice(0, 60)}...`)
}

// 场景 7: 记忆写入 — 对话应自动存入 EverOS
async function testMemoryWrite() {
  const CASE = '记忆写入'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 自我介绍后，对话应存入记忆\x1b[0m`)

  const { fullResponse } = await sendChat('记住一下，我最喜欢的编程语言是 Rust，周末喜欢去爬山')

  assert(CASE, 'Jarvis 有回应', fullResponse.length > 10, fullResponse.slice(0, 60), start)
  assert(CASE, '回复确认了偏好', fullResponse.includes('Rust') || fullResponse.includes('爬山') || fullResponse.includes('记') || fullResponse.includes('noted'), fullResponse.slice(0, 80), start)

  // 等一下让记忆写入完成
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log(`  ✓ 回复: ${fullResponse.slice(0, 60)}...`)
}

// 场景 8: 记忆检索 — 应能从记忆中找到之前的信息
async function testMemorySearch() {
  const CASE = '记忆检索'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 询问偏好时，应从记忆中检索并回答\x1b[0m`)

  // 注意：这取决于 EverOS 是否已经处理完了之前的消息
  // 如果之前跑过多次测试，应该已经有记忆了
  const { fullResponse } = await sendChat('你还记得我喜欢什么编程语言吗？')

  assert(CASE, '有回复', fullResponse.length > 10, fullResponse.slice(0, 60), start)
  // 记忆可能还没被提取（异步），所以这里宽松验证
  const hasMemory = fullResponse.includes('Rust') || fullResponse.includes('攀岩') || fullResponse.includes('爬山') || fullResponse.includes('日料') || fullResponse.includes('咖啡')
  assert(CASE, '回复包含记忆内容（可能需要时间生效）', hasMemory, fullResponse.slice(0, 80), start)

  console.log(`  ✓ 回复: ${fullResponse.slice(0, 80)}...`)
}

// 场景 9: 重启后无幽灵任务 — 启动时应清理遗留任务
async function testNoGhostTasks() {
  const CASE = '无幽灵任务'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] 启动时应无 executing 状态的遗留任务\x1b[0m`)

  // cleanupStaleTasks 已在启动时调用，现在验证结果
  const tasks = await getTaskSummary()
  const hasGhost = tasks.includes('[executing]') || tasks.includes('[planning]')
  assert(CASE, '无 executing/planning 遗留', !hasGhost, tasks.slice(0, 80), start)

  console.log(`  ✓ 状态: ${tasks.slice(0, 60)}`)
}

// 场景 10: /tasks 快捷命令 — 应能通过 API 获取任务列表
async function testTasksEndpoint() {
  const CASE = '任务端点'
  const start = Date.now()
  console.log(`\n\x1b[1m[${CASE}] /tasks API 应返回任务摘要\x1b[0m`)

  const res = await fetch(`${API}/tasks`)
  const data = await res.json()

  assert(CASE, 'API 返回 200', res.ok, `status: ${res.status}`, start)
  assert(CASE, '有 summary 字段', 'summary' in data, JSON.stringify(Object.keys(data)), start)

  console.log(`  ✓ 任务摘要: ${data.summary?.slice(0, 60) || '(空)'}`)
}

// ─── 运行 ───

async function run() {
  console.log('\x1b[1m╔══════════════════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[1m║  Jarvis v0.1 全场景自动化评测                     ║\x1b[0m')
  console.log('\x1b[1m╚══════════════════════════════════════════════════╝\x1b[0m')
  console.log()
  console.log('\x1b[2m  覆盖: 基本对话 | 任务分配 | 查询进展 | 实时打断\x1b[0m')
  console.log('\x1b[2m        后台事件 | 取消任务 | 记忆写入 | 记忆检索\x1b[0m')
  console.log('\x1b[2m        无幽灵任务 | 任务端点\x1b[0m')
  console.log()

  cleanupStaleTasks()
  startJarvisServer()
  await new Promise(resolve => setTimeout(resolve, 1000))

  startGlobalEventListener()
  await new Promise(resolve => setTimeout(resolve, 200))

  try {
    await testNoGhostTasks()
    await testSimpleChat()
    await testTaskAssignment()
    await testQueryProgress()
    await testInterrupt()
    await testBackgroundEvents()
    await testCancelTask()
    await testMemoryWrite()
    await testMemorySearch()
    await testTasksEndpoint()
  } catch (err) {
    console.error('\n\x1b[31m评测异常中断:\x1b[0m', err instanceof Error ? err.message : err)
  }

  // ─── 汇总 ───
  console.log('\n\x1b[1m═══════════════════════════════════════════════════\x1b[0m')
  console.log('\x1b[1m  评测结果汇总\x1b[0m')
  console.log('\x1b[1m═══════════════════════════════════════════════════\x1b[0m\n')

  let passed = 0
  let failed = 0
  let currentCase = ''

  for (const r of results) {
    if (r.case !== currentCase) {
      currentCase = r.case
      console.log(`\n  \x1b[1m${currentCase}\x1b[0m`)
    }
    const icon = r.passed ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m'
    const time = `\x1b[2m(${r.duration}ms)\x1b[0m`
    console.log(`    ${icon} ${r.name} ${time}`)
    if (!r.passed) {
      console.log(`       \x1b[2m→ ${r.detail}\x1b[0m`)
    }
    if (r.passed) passed++
    else failed++
  }

  console.log('\n  ─────────────────────────────────────')
  console.log(`  \x1b[1m总计: ${results.length} 项 | 通过: ${passed} | 失败: ${failed}\x1b[0m`)
  console.log(`  \x1b[1m通过率: ${Math.round(passed / results.length * 100)}%\x1b[0m`)
  console.log()

  stopGlobalEventListener()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('\x1b[31m评测启动失败:\x1b[0m', err.message || err)
  process.exit(1)
})
