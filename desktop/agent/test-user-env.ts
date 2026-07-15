/**
 * 防回归测试：buildUserEnv 核心不变式
 *
 * 运行方式：npx tsx desktop/agent/test-user-env.ts
 *
 * 覆盖：
 *   1. 全局 agentEnv 不被污染（核心安全不变式）
 *   2. 有凭证结果隔离（ANTHROPIC_AUTH_TOKEN / DEFAULT_* 被删除，用户值正确写入）
 *   3. 无凭证回退（返回新对象 !== agentEnv，平台变量保留）
 */
import { agentEnv } from './shared/config.js'
import { buildUserEnv } from './shared/user-env.js'
import { addCredential, deleteCredential, listCredentials } from './auth/credentials.js'

const TEST_USER = `__test_user_env_${Date.now()}`

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.log(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

// ─── 清理工具 ───────────────────────────────────────────────────────────────
async function cleanup() {
  const creds = await listCredentials(TEST_USER)
  for (const c of creds) {
    await deleteCredential(TEST_USER, c.id)
  }
}

// ─── 测试 1：全局 agentEnv 不被污染 ─────────────────────────────────────────
async function testNoGlobalMutation() {
  console.log('\n═══ 测试 1: 全局 agentEnv 不被污染（核心安全不变式）═══')

  // 快照调用前的 agentEnv（序列化后比较，不管有没有 ANTHROPIC_AUTH_TOKEN）
  const snapshotBefore = JSON.stringify(agentEnv)

  // 插入一条凭证并调用「有凭证路径」
  await addCredential(TEST_USER, {
    label: '测试凭证',
    tier: 'standard',
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.example.com',
    model: 'test-model',
    isDefault: true,
  })

  await buildUserEnv(TEST_USER)

  const snapshotAfter = JSON.stringify(agentEnv)
  assert(snapshotBefore === snapshotAfter, 'agentEnv 调用前后完全一致（无 mutation）')

  // 额外独立断言：不管原先是否存在，ANTHROPIC_AUTH_TOKEN 在 agentEnv 里的值不变
  const tokenBefore = JSON.parse(snapshotBefore)['ANTHROPIC_AUTH_TOKEN']
  assert(agentEnv['ANTHROPIC_AUTH_TOKEN'] === tokenBefore, 'agentEnv.ANTHROPIC_AUTH_TOKEN 未被修改')

  // ANTHROPIC_DEFAULT_* 系列不变
  const keysBefore = Object.keys(JSON.parse(snapshotBefore)).filter(k => k.startsWith('ANTHROPIC_DEFAULT_'))
  const keysAfter  = Object.keys(agentEnv).filter(k => k.startsWith('ANTHROPIC_DEFAULT_'))
  assert(
    keysBefore.length === keysAfter.length &&
    keysBefore.every(k => agentEnv[k] === JSON.parse(snapshotBefore)[k]),
    'agentEnv.ANTHROPIC_DEFAULT_* 键均未被修改'
  )
}

// ─── 测试 2：有凭证结果隔离 ──────────────────────────────────────────────────
async function testWithCredential() {
  console.log('\n═══ 测试 2: 有凭证结果隔离 ═══')

  const result = await buildUserEnv(TEST_USER)

  // 返回对象不是 agentEnv 本身（引用隔离）
  assert(result !== agentEnv, '返回新对象（!== agentEnv）')

  // 用户值正确写入
  assert(result['ANTHROPIC_API_KEY'] === 'sk-test-key', 'ANTHROPIC_API_KEY 是用户值')
  assert(result['ANTHROPIC_BASE_URL'] === 'https://api.example.com', 'ANTHROPIC_BASE_URL 是用户值')
  assert(result['ANTHROPIC_MODEL'] === 'test-model', 'ANTHROPIC_MODEL 是用户值')

  // 平台认证变量被删除
  assert(!('ANTHROPIC_AUTH_TOKEN' in result), 'ANTHROPIC_AUTH_TOKEN 不存在于结果中')

  // ANTHROPIC_DEFAULT_* 全部被删除
  const defaultKeys = Object.keys(result).filter(k => k.startsWith('ANTHROPIC_DEFAULT_'))
  assert(defaultKeys.length === 0, 'ANTHROPIC_DEFAULT_* 键全部不存在于结果中')
}

// ─── 测试 3：无凭证回退 ──────────────────────────────────────────────────────
async function testNoCredential() {
  console.log('\n═══ 测试 3: 无凭证回退 ═══')

  const noUserResult = await buildUserEnv('__non_existent_user_xyz__')

  // 返回新对象（不是 agentEnv 引用）
  assert(noUserResult !== agentEnv, '无凭证：返回新对象（!== agentEnv）')

  // 平台变量保留（agentEnv 里有多少平台键，新对象里都有）
  const platformKeys = Object.keys(agentEnv)
  const missingKeys = platformKeys.filter(k => !(k in noUserResult))
  assert(missingKeys.length === 0, '无凭证：平台变量全部保留')
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('🧪 buildUserEnv 防回归测试\n')

  try {
    // 确保干净起点
    await cleanup()

    await testNoGlobalMutation()
    await testWithCredential()
    await testNoCredential()
  } finally {
    // 测试数据删干净
    await cleanup()
    console.log('\n  [cleanup] 测试数据已清除')
  }

  console.log(`\n${'═'.repeat(45)}`)
  console.log(`总计: ${passed + failed} | ✓ 通过: ${passed} | ❌ 失败: ${failed}`)
  console.log('═'.repeat(45))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('测试异常:', err)
  process.exit(1)
})
