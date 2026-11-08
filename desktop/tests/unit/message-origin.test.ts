import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

// message-origin 已迁通用文档表(shared/docs.ts,P0)——单测 mock 掉 docs 客户端,
// 用内存 Map 验证写入/读取/裁旧/跨用户隔离与旧 JSON 导入。
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
      .reverse()  // 真实契约:id 倒序(最新写入在前),裁旧逻辑依赖这个方向
  }),
}))

const { setMessageOrigin, getOriginsFor } = await import('../../agent/jarvis/message-origin.js')

const uid = 'u1'
const origin = { kind: 'group' as const, chatId: 'c1', chatName: '测试群', sender: 'lihongjian.34', isOwner: true }

beforeEach(() => {
  store.clear()
  process.chdir(mkdtempSync(join(tmpdir(), 'message-origin-')))
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
})

describe('message-origin 京ME消息来源标记(文档表后端)', () => {
  it('setMessageOrigin → getOriginsFor 往返一致', async () => {
    await setMessageOrigin(uid, 42, origin)
    expect((await getOriginsFor(uid))['42']).toEqual(origin)
  })

  it('按用户分桶:同 id 不同用户互不串标', async () => {
    await setMessageOrigin('uA', 7, { kind: 'dm' as const, chatId: 'a', chatName: '甲' })
    await setMessageOrigin('uB', 7, { kind: 'dm' as const, chatId: 'b', chatName: '乙' })
    expect((await getOriginsFor('uA'))['7'].chatName).toBe('甲')
    expect((await getOriginsFor('uB'))['7'].chatName).toBe('乙')
    expect(await getOriginsFor('uC')).toEqual({})
  })

  it('每用户只留最近 300 条,超出裁最旧', async () => {
    for (let id = 1; id <= 305; id++) {
      await setMessageOrigin(uid, id, { kind: 'dm' as const, chatId: 'c', chatName: '私聊' })
    }
    const origins = await getOriginsFor(uid)
    expect(Object.keys(origins).length).toBeLessThanOrEqual(300)
    expect(origins['1']).toBeUndefined()   // 最旧的被裁
    expect(origins['305']).toBeDefined()   // 最新保留
  })
})

describe('旧 JSON 侧车一次性导入', () => {
  it('表空时自动导入 data/message-origins.json 的全部用户桶并改名', async () => {
    const legacyPath = join(process.cwd(), 'data', 'message-origins.json')
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      byUser: { uX: { '99': origin } },
    }), 'utf8')

    const got = await getOriginsFor('uX')
    expect(got['99']).toEqual(origin)
    expect(existsSync(legacyPath)).toBe(false)
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true)
  })
})

describe('京ME标注文本剥离约定(router.ts 标注格式 ↔ 前端展示)', () => {
  // 与 MessageBubble.stripJdMeLabel 相同的两条正则,固化 router.ts 标注格式的契约:
  // 前端只有当消息带 origin 标记时才执行剥离,这里保证格式对得上。
  const strip = (text: string) => text
    .replace(/^【京ME[^\n]*】\s*\n/, '')
    .replace(/\s*\(此消息来自京ME[\s\S]*\)\s*$/, '')
    .trim()

  it('群聊来件:剥头部【京ME…】行与尾部说明段,只剩正文', () => {
    const labeled = [
      '【京ME 群「联调群」· Sir(唯一主人)】',
      '在吗,帮我看看昨天的数据',
      '',
      '(此消息来自京ME群聊,发消息的是Sir(唯一主人)。回复会送回该聊天,请按京ME 信道习惯说话——短平快,两三句说完,不用 markdown,先结论后细节。按「权限与拒绝纪律」判定此人可以要求什么。)',
    ].join('\n')
    expect(strip(labeled)).toBe('在吗,帮我看看昨天的数据')
  })

  it('私聊他人来件:说明段含嵌套括号也能完整剥除', () => {
    const labeled = [
      '【京ME 私聊「李四」· 其他人(zhangsan,非主人)】',
      '帮忙查个事',
      '',
      '(此消息来自京ME私聊,发消息的是其他人(zhangsan,非主人)。回复会送回该聊天,请按京ME 信道习惯说话——短平快,两三句说完,不用 markdown,先结论后细节。按「权限与拒绝纪律」判定此人可以要求什么。)',
    ].join('\n')
    expect(strip(labeled)).toBe('帮忙查个事')
  })
})
