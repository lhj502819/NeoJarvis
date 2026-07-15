import { describe, it, expect, beforeEach, vi } from 'vitest'

// v0.3: these manager functions now call the Java server instead of PG directly.
// Mock the HTTP client and assert the right endpoint + body is used (ordering of turns is
// now the server's responsibility, so getSubtaskTurns just passes the list through).
const { serverGet, serverPost, serverPatch } = vi.hoisted(() => ({
  serverGet: vi.fn(),
  serverPost: vi.fn(),
  serverPatch: vi.fn(),
}))
vi.mock('../../src/shared/server-client.js', () => ({
  serverGet,
  serverPost,
  serverPatch,
  serverDelete: vi.fn(),
}))

const { setSubtaskStarted, recordTurn, finalizeSubtaskMeta, getSubtaskTurns } = await import('../../src/task/manager.js')

const SUB = 's-meta-1'

describe('subtask 元信息读写', () => {
  beforeEach(() => {
    serverGet.mockReset()
    serverPost.mockReset().mockResolvedValue({ ok: true })
    serverPatch.mockReset().mockResolvedValue({ ok: true })
  })

  it('setSubtaskStarted -> PATCH /started', async () => {
    const ts = new Date().toISOString()
    await setSubtaskStarted(SUB, ts)
    expect(serverPatch).toHaveBeenCalledWith('local', `/api/subtask/${SUB}/started`, { startedAt: ts })
  })

  it('recordTurn -> POST /turns;getSubtaskTurns 透传服务端顺序', async () => {
    const t0 = new Date().toISOString()
    await recordTurn(SUB, 1, '第一回合', t0, t0)
    await recordTurn(SUB, 2, '第二回合', t0, t0)
    expect(serverPost).toHaveBeenCalledWith('local', `/api/subtask/${SUB}/turns`, { turnIndex: 1, text: '第一回合', startedAt: t0, endedAt: t0 })
    expect(serverPost).toHaveBeenCalledWith('local', `/api/subtask/${SUB}/turns`, { turnIndex: 2, text: '第二回合', startedAt: t0, endedAt: t0 })

    serverGet.mockResolvedValueOnce([
      { id: 'a', subtaskId: SUB, turnIndex: 1, text: '第一回合', startedAt: t0, endedAt: t0, createdAt: t0 },
      { id: 'b', subtaskId: SUB, turnIndex: 2, text: '第二回合', startedAt: t0, endedAt: t0, createdAt: t0 },
    ])
    const turns = await getSubtaskTurns(SUB)
    expect(serverGet).toHaveBeenCalledWith('local', `/api/subtask/${SUB}/turns`)
    expect(turns.length).toBe(2)
    expect(turns[0].turnIndex).toBe(1)
    expect(turns[1].text).toBe('第二回合')
  })

  it('finalizeSubtaskMeta -> PATCH /meta 传统计', async () => {
    const meta = { turnCount: 5, retryCount: 1, tokensInput: 100, tokensOutput: 200 }
    await finalizeSubtaskMeta(SUB, meta)
    expect(serverPatch).toHaveBeenCalledWith('local', `/api/subtask/${SUB}/meta`, meta)
  })
})
