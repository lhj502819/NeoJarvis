import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const store = new Map<string, unknown>()
const seqMap = new Map<string, number>()
let seqCounter = 0

vi.mock('../../agent/shared/docs.js', () => ({
  docPut: vi.fn(async (userId: string, kind: string, key: string, data: unknown) => {
    const k = `${userId}:${kind}:${key}`
    store.set(k, structuredClone(data))
    seqMap.set(k, ++seqCounter)
  }),
  docGet: vi.fn(async (userId: string, kind: string, key: string) => {
    const hit = store.get(`${userId}:${kind}:${key}`)
    return hit === undefined ? null : structuredClone(hit)
  }),
  docDelete: vi.fn(async (userId: string, kind: string, key: string) => {
    store.delete(`${userId}:${kind}:${key}`)
  }),
  // 真实契约:id 倒序(最新写入在前)+ limit 裁剪 —— prune 方向测试依赖这个语义
  docList: vi.fn(async (userId: string, kind: string, prefix = '', limit = 200) => {
    return [...store.entries()]
      .filter(([k]) => k.startsWith(`${userId}:${kind}:${prefix}`))
      .map(([k, data]) => ({ key: k.slice(`${userId}:${kind}:`.length), data: structuredClone(data), seq: seqMap.get(k) ?? 0 }))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
  }),
}))

const { createPendingReply, completeReply, getReply } = await import('../../agent/mcp/reply-inbox.js')

const USER = 'u-mcp'

beforeEach(() => {
  store.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MCP 回复收件箱', () => {
  it('pending → done:回复可取回', async () => {
    await createPendingReply(USER, 'm1', '问题', 'Claude Code')
    expect((await getReply(USER, 'm1'))!.status).toBe('pending')
    await completeReply(USER, 'm1', '收到')
    const record = await getReply(USER, 'm1')!
    expect(record!.status).toBe('done')
    expect(record!.reply).toBe('收到')
  })

  it('未知 msgId → null', async () => {
    expect(await getReply(USER, 'nope')).toBeNull()
  })

  it('pending 超过 10 分钟 → 视为 expired', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T10:00:00'))
    await createPendingReply(USER, 'm2', '问题', 'Codex')
    vi.setSystemTime(new Date('2026-11-13T10:11:00'))
    expect((await getReply(USER, 'm2'))!.status).toBe('expired')
  })

  it('裁剪方向:超过 KEEP 时删最旧、留最新(评审修复回归)', async () => {
    for (let i = 0; i < 145; i++) {
      await createPendingReply(USER, `m-${i}`, `问题${i}`, 'Claude Code')
    }
    // createPendingReply 里的 pruneReplies 是 fire-and-forget,等它落定
    await new Promise(r => setTimeout(r, 60))
    const keys = [...store.keys()]
      .filter(k => k.includes('mcp-reply'))
      .map(k => k.split(':')[2]!)
    expect(keys.includes('m-144')).toBe(true)    // 最新保留
    expect(keys.includes('m-143')).toBe(true)
    expect(keys.includes('m-0')).toBe(false)     // 最旧被删(旧实现方向反了:删的是最新)
    expect(keys.includes('m-10')).toBe(false)
    expect(keys.length).toBeLessThanOrEqual(140)
  })
})
