import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../agent/jarvis/brain.js', () => ({
  think: vi.fn(async () => ({ response: 'mock response' })),
  addToBuffer: vi.fn(async () => {}),
}))

import { enqueueMessage, handleDisconnect, getStatus, type SSEWriter } from '../../agent/jarvis/orchestrator.js'

function createMockWriter(id?: string): SSEWriter {
  return {
    id: id || `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    send: vi.fn(),
    end: vi.fn(),
    closed: false,
  }
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('orchestrator state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('single message: idle → buffering → thinking → idle', async () => {
    const userId = `test-${Date.now()}`
    const writer = createMockWriter()

    await enqueueMessage(userId, '你好', writer)

    // After 100ms quick buffer + think completes
    await wait(300)

    expect(writer.send).toHaveBeenCalledWith('thinking', expect.any(String))
    expect(writer.send).toHaveBeenCalledWith('response', 'mock response')
    expect(writer.end).toHaveBeenCalled()
    expect(getStatus(userId).state).toBe('idle')
  })

  it('rapid messages merge into single think', async () => {
    const userId = `test-merge-${Date.now()}`
    const writer1 = createMockWriter()
    const writer2 = createMockWriter()

    await enqueueMessage(userId, '帮我查天气', writer1)
    await wait(50) // Within BUFFER_QUICK_MS
    await enqueueMessage(userId, '北京的', writer2)

    // Wait for buffer window (1500ms) + think
    await wait(2000)

    const { think } = await import('../../agent/jarvis/brain.js')
    const calls = (think as any).mock.calls
    expect(calls.length).toBe(1)
    expect(calls[0][1]).toContain('帮我查天气')
    expect(calls[0][1]).toContain('北京的')
  })

  it('disconnect cancels pending work', async () => {
    const userId = `test-dc-${Date.now()}`
    const writer = createMockWriter()

    await enqueueMessage(userId, '你好', writer)
    // Immediately disconnect
    handleDisconnect(userId, writer.id)

    await wait(200)
    expect(getStatus(userId).state).toBe('idle')
  })

  it('getStatus returns idle for unknown user', () => {
    expect(getStatus('nonexistent').state).toBe('idle')
  })
})
