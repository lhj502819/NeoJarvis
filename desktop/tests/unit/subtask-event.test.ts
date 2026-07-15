import { describe, it, expect } from 'vitest'
import { buildSubtaskEvent } from '../../agent/jarvis/subtask-event.js'

describe('buildSubtaskEvent', () => {
  it('running 事件带 turnCount 与 currentTool', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: '差旅出行专家', taskName: '清迈攻略',
      status: 'running', turnCount: 14,
      currentAction: '正在核对交通费用', currentTool: 'semble',
    })
    expect(evt).toEqual({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: '差旅出行专家', taskName: '清迈攻略',
      status: 'running', turnCount: 14,
      currentAction: '正在核对交通费用', currentTool: 'semble',
    })
  })

  it('done 事件不带 currentTool/currentAction', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X专家', taskName: 't',
      status: 'done', turnCount: 18,
    })
    expect(evt.status).toBe('done')
    expect(evt.turnCount).toBe(18)
    expect(evt.currentTool).toBeUndefined()
    expect(evt.currentAction).toBeUndefined()
  })

  it('failed 事件带 error', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X专家', taskName: 't',
      status: 'failed', turnCount: 3, error: 'API 500',
    })
    expect(evt.status).toBe('failed')
    expect(evt.error).toBe('API 500')
  })

  it('startedAt 存在则计算 elapsedMs(≥0)', () => {
    const past = Date.now() - 5000
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X', taskName: 't',
      status: 'running', turnCount: 1, startedAt: past,
    })
    expect(evt.elapsedMs).toBeGreaterThanOrEqual(4000)
    expect(evt.elapsedMs).toBeLessThan(60000)
  })

  it('startedAt 未提供则 elapsedMs 为 undefined', () => {
    const evt = buildSubtaskEvent({
      subtaskId: 'st-1', taskId: 't-1',
      agentName: 'X', taskName: 't',
      status: 'running', turnCount: 1,
    })
    expect(evt.elapsedMs).toBeUndefined()
  })
})
