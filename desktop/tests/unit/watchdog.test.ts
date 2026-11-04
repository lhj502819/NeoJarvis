import { describe, it, expect } from 'vitest'
import { evaluateSubtaskRisk } from '../../agent/jarvis/watchdog.js'

const NOW = new Date('2026-11-01T12:00:00+08:00')
const min = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()

const healthy = {
  status: 'running',
  startedAt: min(3),
  updatedAt: min(1),
  lastTurnAt: min(1),
  hasLiveSession: true,
  retryCount: 0,
}

describe('evaluateSubtaskRisk', () => {
  it('健康子任务(刚有回合)无信号', () => {
    expect(evaluateSubtaskRisk(healthy, NOW)).toBeNull()
  })

  it('非 running 状态直接跳过', () => {
    expect(evaluateSubtaskRisk({ ...healthy, status: 'completed' }, NOW)).toBeNull()
  })

  it('超过宽限期内无会话不算僵尸(派单空窗)', () => {
    expect(evaluateSubtaskRisk({ ...healthy, hasLiveSession: false, startedAt: min(1) }, NOW)).toBeNull()
  })

  it('僵尸:会话不在且超过宽限期', () => {
    const s = evaluateSubtaskRisk({ ...healthy, hasLiveSession: false, startedAt: min(5) }, NOW)
    expect(s?.kind).toBe('zombie')
  })

  it('没动静:最后一次回合超过阈值', () => {
    const s = evaluateSubtaskRisk({ ...healthy, lastTurnAt: min(11) }, NOW, { idleMin: 10, maxMin: 30 })
    expect(s?.kind).toBe('idle')
  })

  it('没动静:从未有回合时按开始时间算', () => {
    const s = evaluateSubtaskRisk({ ...healthy, lastTurnAt: null, startedAt: min(11) }, NOW, { idleMin: 10, maxMin: 30 })
    expect(s?.kind).toBe('idle')
  })

  it('跑太久:总时长超过上限', () => {
    const s = evaluateSubtaskRisk({ ...healthy, startedAt: min(31), lastTurnAt: min(1) }, NOW, { idleMin: 10, maxMin: 30 })
    expect(s?.kind).toBe('overtime')
  })

  it('僵尸优先于没动静', () => {
    const s = evaluateSubtaskRisk({ ...healthy, hasLiveSession: false, startedAt: min(15), lastTurnAt: min(15) }, NOW)
    expect(s?.kind).toBe('zombie')
  })

  it('连环失败:重试次数达阈值', () => {
    const s = evaluateSubtaskRisk({ ...healthy, startedAt: min(2), retryCount: 2 }, NOW)
    expect(s?.kind).toBe('repeat_fail')
  })

  it('阈值可调', () => {
    const s = evaluateSubtaskRisk({ ...healthy, lastTurnAt: min(6) }, NOW, { idleMin: 5, maxMin: 30 })
    expect(s?.kind).toBe('idle')
  })
})
