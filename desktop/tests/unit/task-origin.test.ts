import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

// task-origin 读写 data/task-origins.json,用 JARVIS 的 cwd 机制换不了 ——
// 它用 process.cwd()。这里通过临时目录 + 进程内先 import 前改 cwd 的方式隔离。
const origCwd = process.cwd()

async function freshModule() {
  const dir = mkdtempSync(join(tmpdir(), 'task-origin-'))
  process.chdir(dir)
  try {
    const mod = await import('../../agent/jarvis/task-origin.js')
    return { mod, dir }
  } finally {
    process.chdir(origCwd)
  }
}

describe('task-origin 登记与清除', () => {
  beforeEach(() => {
    // 每个用例独立临时目录,模块缓存会保留 loaded 标志,但 cwd 变了路径也变 ——
    // 为隔离彻底,重置模块缓存
    vi?.resetModules?.()
  })

  it('setTaskOrigin → getTaskOrigin 往返一致,并落盘', async () => {
    const { mod, dir } = await freshModule()
    await mod.setTaskOrigin('t1', { kind: 'group', chatId: '10236132771', chatName: '测试群' })
    const origin = await mod.getTaskOrigin('t1')
    expect(origin).toEqual({ kind: 'group', chatId: '10236132771', chatName: '测试群' })
    const raw = JSON.parse(await readFile(join(dir, 'data', 'task-origins.json'), 'utf8'))
    expect(raw.origins.t1.chatId).toBe('10236132771')
  })

  it('clearTaskOrigin 删除登记;未登记的 get 返回 null', async () => {
    const { mod } = await freshModule()
    expect(await mod.getTaskOrigin('none')).toBeNull()
    await mod.setTaskOrigin('t2', { kind: 'dm', chatId: 'zhangsan', chatName: 'zhangsan' })
    await mod.clearTaskOrigin('t2')
    expect(await mod.getTaskOrigin('t2')).toBeNull()
    // 清不存在的也不抛
    await expect(mod.clearTaskOrigin('t2')).resolves.toBeUndefined()
  })
})

describe('JDME 同步短讯解析逻辑(纯函数行为,通过字符串约定)', () => {
  it('=====JDME===== 之后的段落可被 split 提取,正文不含标记', () => {
    const report = '正文汇报。\n=====JDME=====\n办完了,master 已推。\n细节可问。'
    const [main, ...rest] = report.split('=====JDME=====')
    expect(main.trim()).toBe('正文汇报。')
    expect(rest.join('').split('=====JDME=====')[0].trim()).toBe('办完了,master 已推。\n细节可问。')
  })

  it('没有标记时不触发同步(origin 分支要求 includes)', () => {
    const report = '普通汇报,没有额外短讯。'
    expect(report.includes('=====JDME=====')).toBe(false)
  })
})
