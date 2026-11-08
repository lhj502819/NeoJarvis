import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

// task-origin 已迁通用文档表(shared/docs.ts,P0)——单测 mock 掉 docs 客户端,
// 用内存 Map 验证登记/清除/降级行为;旧 JSON 侧车的导入逻辑用真实临时文件驱动。
const store = new Map<string, unknown>()

vi.mock('../../agent/shared/docs.js', () => ({
  docPut: vi.fn(async (userId: string, kind: string, key: string, data: unknown) => {
    store.set(`${userId}:${kind}:${key}`, structuredClone(data))
  }),
  docGet: vi.fn(async (userId: string, kind: string, key: string) => {
    const hit = store.get(`${userId}:${kind}:${key}`)
    return hit === undefined ? null : structuredClone(hit)
  }),
  docDelete: vi.fn(async (userId: string, kind: string, key: string) => {
    store.delete(`${userId}:${kind}:${key}`)
  }),
  docList: vi.fn(async (userId: string, kind: string, _prefix = '', _limit = 200) => {
    return [...store.entries()]
      .filter(([k]) => k.startsWith(`${userId}:${kind}:`))
      .map(([k, data]) => ({ key: k.split(':')[2]!, data: structuredClone(data) }))
  }),
}))

const { setTaskOrigin, getTaskOrigin, clearTaskOrigin } = await import('../../agent/jarvis/task-origin.js')

const uid = 'u1'
const origin = { kind: 'group' as const, chatId: '10236132771', chatName: '测试群', sender: 'lihongjian.34', isOwner: true }

beforeEach(() => {
  store.clear()
  // getTaskOrigin 的"表空→导入旧 JSON"分支需要 cwd 里有 data/task-origins.json;
  // 默认给一个空目录,个别用例自己写文件
  process.chdir(mkdtempSync(join(tmpdir(), 'task-origin-')))
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
})

describe('task-origin 登记(文档表后端)', () => {
  it('setTaskOrigin → getTaskOrigin 往返一致', async () => {
    await setTaskOrigin(uid, 't1', origin)
    expect(await getTaskOrigin(uid, 't1')).toEqual(origin)
  })

  it('clearTaskOrigin 删除登记;未登记的 get 返回 null', async () => {
    expect(await getTaskOrigin(uid, 'none')).toBeNull()
    await setTaskOrigin(uid, 't2', origin)
    await clearTaskOrigin(uid, 't2')
    expect(await getTaskOrigin(uid, 't2')).toBeNull()
    // 清不存在的也不抛
    await expect(clearTaskOrigin(uid, 't2')).resolves.toBeUndefined()
  })

  it('按用户隔离:同 taskId 不同用户互不串', async () => {
    await setTaskOrigin('uA', 't9', origin)
    await setTaskOrigin('uB', 't9', { kind: 'dm' as const, chatId: 'zhangsan', chatName: 'zhangsan' })
    expect((await getTaskOrigin('uA', 't9'))!.chatName).toBe('测试群')
    expect((await getTaskOrigin('uB', 't9'))!.chatName).toBe('zhangsan')
  })
})

describe('旧 JSON 侧车一次性导入', () => {
  it('表空时自动导入 data/task-origins.json 并改名为 .migrated', async () => {
    const legacyPath = join(process.cwd(), 'data', 'task-origins.json')
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      origins: { 't-legacy': { kind: 'dm', chatId: 'zhangsan', chatName: 'zhangsan' } },
    }), 'utf8')

    const got = await getTaskOrigin(uid, 't-legacy')
    expect(got).toEqual({ kind: 'dm', chatId: 'zhangsan', chatName: 'zhangsan' })
    expect(existsSync(legacyPath)).toBe(false)
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true)
  })
})

describe('京ME 同步短讯解析逻辑(纯函数行为,通过字符串约定)', () => {
  it('=====JDME===== 之后的段落可被 split 提取,正文不含标记', () => {
    const report = '正文汇报。\n=====JDME=====\n办完了,master 已推。\n细节可问。'
    const [main, ...rest] = report.split('=====JDME=====')
    expect(main.trim()).toBe('正文汇报。')
    expect(rest.join('').split('=====JDME=====')[0]!.trim()).toBe('办完了,master 已推。\n细节可问。')
  })

  it('没有标记时不触发同步(origin 分支要求 includes)', () => {
    const report = '普通汇报,没有额外短讯。'
    expect(report.includes('=====JDME=====')).toBe(false)
  })
})
