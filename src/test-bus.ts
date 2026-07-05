/**
 * 集成测试：MessageBus 通信层 + 任务管理 + 打断机制
 * 不依赖 LLM 调用，直接验证核心通信逻辑
 */
import { bus } from './a2a/bus.js'
import { createTask, addSubTask, getTask, updateTask, updateSubTask } from './task/manager.js'
import { registerRunningTask, unregisterRunningTask, listAllRunningTasks } from './a2a/registry.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`)
    passed++
  } else {
    console.log(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

async function testBusRegistration() {
  console.log('\n═══ 测试 1: Bus 注册/注销 ═══')

  bus.register('test-agent-1', 'TestAgent1', async (msg) => {
    return {
      id: `reply-${Date.now()}`,
      from: 'test-agent-1',
      to: msg.from,
      contextId: msg.contextId,
      role: 'agent' as const,
      parts: [{ kind: 'text' as const, text: `收到: ${msg.parts[0]?.text}` }],
      timestamp: new Date().toISOString(),
    }
  })

  assert(bus.isRegistered('test-agent-1'), 'agent 注册成功')
  assert(!bus.isRegistered('nonexistent'), '不存在的 agent 返回 false')

  const agents = bus.listAgents()
  assert(agents.some(a => a.id === 'test-agent-1'), 'listAgents 能列出注册的 agent')
}

async function testSyncSend() {
  console.log('\n═══ 测试 2: 同步消息发送（send）— 模拟小弟请示 Jarvis ═══')

  bus.register('mock-jarvis', 'MockJarvis', async (msg) => {
    const question = msg.parts[0]?.text || ''
    return {
      id: `j-reply-${Date.now()}`,
      from: 'mock-jarvis',
      to: msg.from,
      contextId: msg.contextId,
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: `决策: 针对「${question}」，继续执行方案A` }],
      timestamp: new Date().toISOString(),
    }
  })

  const reply = await bus.send('test-agent-1', 'mock-jarvis', 'task-001', '这个 API 应该用 GET 还是 POST?')
  assert(reply !== null, 'send 收到回复')
  assert(reply!.parts[0]?.text?.includes('继续执行方案A') ?? false, '回复内容正确')
  assert(reply!.from === 'mock-jarvis', '回复来源正确')

  const conv = bus.getConversation('task-001')
  assert(conv !== undefined, '对话记录被创建')
  assert(conv!.messages.length >= 2, '对话包含请求和回复')
  assert(conv!.participants.includes('test-agent-1'), '参与者包含发送方')
  assert(conv!.participants.includes('mock-jarvis'), '参与者包含接收方')
}

async function testNotify() {
  console.log('\n═══ 测试 3: 异步通知（notify）— 模拟 Jarvis 补充指令 ═══')

  bus.notify('mock-jarvis', 'test-agent-1', 'task-001', '补充要求：注意性能优化')

  const inbox = bus.drainInbox('test-agent-1')
  assert(inbox.length === 1, 'notify 消息进入 inbox')
  assert(inbox[0].parts[0]?.text === '补充要求：注意性能优化', '消息内容正确')

  const inbox2 = bus.drainInbox('test-agent-1')
  assert(inbox2.length === 0, 'drainInbox 清空后再次获取为空')
}

async function testBroadcast() {
  console.log('\n═══ 测试 4: 广播（broadcast）— 模拟全员通知 ═══')

  bus.register('test-agent-2', 'TestAgent2', async () => null)

  bus.broadcast('mock-jarvis', 'task-001', '紧急通知：优先级提升')

  const inbox1 = bus.drainInbox('test-agent-1')
  const inbox2 = bus.drainInbox('test-agent-2')
  const inboxJarvis = bus.drainInbox('mock-jarvis')

  assert(inbox1.length === 1, 'agent-1 收到广播')
  assert(inbox2.length === 1, 'agent-2 收到广播')
  assert(inboxJarvis.length === 0, '发送者自己不收到广播')
}

async function testConversationHistory() {
  console.log('\n═══ 测试 5: 对话历史持久化 ═══')

  await bus.send('test-agent-1', 'mock-jarvis', 'task-002', '第二个任务的问题')
  bus.notify('mock-jarvis', 'test-agent-1', 'task-002', '好的，明白了')

  const conv = bus.getConversation('task-002')
  assert(conv !== undefined, 'task-002 对话存在')
  assert(conv!.messages.length >= 2, '包含多条消息')

  const allConvs = bus.getAllConversations()
  assert(allConvs.length >= 2, '有多个对话记录 (task-001, task-002)')

  const agentConvs = bus.getAgentConversations('test-agent-1')
  assert(agentConvs.length >= 1, 'getAgentConversations 按 agent 过滤')
}

async function testTaskManagement() {
  console.log('\n═══ 测试 6: 任务管理 + 子任务 ═══')

  const task = createTask('测试任务', '验证多子任务并行')
  assert(task.id.length > 0, '任务创建成功')

  const sub1 = addSubTask(task.id, { name: '子任务1', description: '调研 SDK', assignee: 'general' })
  const sub2 = addSubTask(task.id, { name: '子任务2', description: '调研协议', assignee: 'general' })
  assert(sub1.id !== sub2.id, '子任务 ID 不同')

  updateTask(task.id, { status: 'executing' })
  const updated = getTask(task.id)
  assert(updated?.status === 'executing', '任务状态更新成功')

  updateSubTask(task.id, sub1.id, { progress: '回合 3 | 已执行 5 步' })
  const t = getTask(task.id)
  const s1 = t?.subtasks.find(s => s.id === sub1.id)
  assert(s1?.progress === '回合 3 | 已执行 5 步', '子任务进度更新成功')
}

async function testRunningTaskRegistry() {
  console.log('\n═══ 测试 7: 运行中任务注册表 ═══')

  registerRunningTask('task-x', 'sub-1', 'general', '调研任务')
  registerRunningTask('task-x', 'sub-2', 'general', '写报告')

  const running = listAllRunningTasks()
  assert(running.length >= 2, '注册了 2 个运行中任务')
  assert(running.some(r => r.subtaskId === 'sub-1'), 'sub-1 在列表中')

  unregisterRunningTask('sub-1')
  const after = listAllRunningTasks()
  assert(!after.some(r => r.subtaskId === 'sub-1'), '注销后 sub-1 不在列表中')

  unregisterRunningTask('sub-2')
}

async function testUnregister() {
  console.log('\n═══ 测试 8: Bus 注销 ═══')

  bus.unregister('test-agent-1')
  bus.unregister('test-agent-2')
  bus.unregister('mock-jarvis')

  assert(!bus.isRegistered('test-agent-1'), 'agent-1 已注销')
  assert(!bus.isRegistered('mock-jarvis'), 'mock-jarvis 已注销')

  const reply = await bus.send('someone', 'test-agent-1', 'ctx', 'hello')
  assert(reply === null, '发送给已注销 agent 返回 null')
}

async function main() {
  console.log('🧪 Jarvis MessageBus 集成测试\n')

  await testBusRegistration()
  await testSyncSend()
  await testNotify()
  await testBroadcast()
  await testConversationHistory()
  await testTaskManagement()
  await testRunningTaskRegistry()
  await testUnregister()

  console.log(`\n${'═'.repeat(40)}`)
  console.log(`总计: ${passed + failed} | ✅ 通过: ${passed} | ❌ 失败: ${failed}`)
  console.log('═'.repeat(40))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('测试异常:', err)
  process.exit(1)
})
