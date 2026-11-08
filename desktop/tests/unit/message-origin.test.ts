import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

// message-origin 读写 data/message-origins.json,用 process.cwd() 定位 ——
// 同 task-origin.test.ts:临时目录 + 先改 cwd 再 import 隔离。
const origCwd = process.cwd()

async function freshModule() {
  const dir = mkdtempSync(join(tmpdir(), 'message-origin-'))
  process.chdir(dir)
  try {
    const mod = await import('../../agent/jarvis/message-origin.js')
    return { mod, dir }
  } finally {
    process.chdir(origCwd)
  }
}

describe('message-origin 京ME消息来源标记', () => {
  beforeEach(() => {
    vi?.resetModules?.()
  })

  it('setMessageOrigin → getOriginsFor 往返一致,并落盘', async () => {
    const { mod, dir } = await freshModule()
    const uid = 'u1'
    await mod.setMessageOrigin(uid, 42, { kind: 'group', chatId: '10236132771', chatName: '测试群', sender: 'lihongjian.34', isOwner: true })
    const origins = await mod.getOriginsFor(uid)
    expect(origins['42']).toEqual({ kind: 'group', chatId: '10236132771', chatName: '测试群', sender: 'lihongjian.34', isOwner: true })
    const raw = JSON.parse(await readFile(join(dir, 'data', 'message-origins.json'), 'utf8'))
    expect(raw.byUser.u1['42'].chatName).toBe('测试群')
  })

  it('按用户分桶:同 id 不同用户互不串标', async () => {
    const { mod } = await freshModule()
    await mod.setMessageOrigin('uA', 7, { kind: 'dm', chatId: 'a', chatName: '甲' })
    await mod.setMessageOrigin('uB', 7, { kind: 'dm', chatId: 'b', chatName: '乙' })
    expect((await mod.getOriginsFor('uA'))['7'].chatName).toBe('甲')
    expect((await mod.getOriginsFor('uB'))['7'].chatName).toBe('乙')
    expect(await mod.getOriginsFor('uC')).toEqual({})
  })

  it('每用户只留最近 MAX_PER_USER(300) 条,超出裁最旧', async () => {
    const { mod } = await freshModule()
    const uid = 'u1'
    for (let id = 1; id <= 302; id++) {
      await mod.setMessageOrigin(uid, id, { kind: 'dm', chatId: 'c', chatName: '私聊' })
    }
    const origins = await mod.getOriginsFor(uid)
    expect(Object.keys(origins).length).toBe(300)
    expect(origins['1']).toBeUndefined()   // 最旧的被裁
    expect(origins['302']).toBeDefined()   // 最新保留
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
