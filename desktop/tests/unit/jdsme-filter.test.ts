import { describe, it, expect } from 'vitest'
import { isGroupAllowed } from '../../agent/events/sources/jdsme-filter.js'

describe('isGroupAllowed', () => {
  it('白名单为空 = 放行全部群', () => {
    expect(isGroupAllowed('any-group', [])).toBe(true)
  })

  it('配置了白名单 = 只放行列出的群', () => {
    expect(isGroupAllowed('g1', ['g1', 'g2'])).toBe(true)
    expect(isGroupAllowed('g3', ['g1', 'g2'])).toBe(false)
  })
})

// ── P4 Gate 结构化判定 ──
import { gateJdmeMessage } from '../../agent/events/sources/jdsme-filter.js'

describe('gateJdmeMessage(P4 准入表)', () => {
  it('私聊恒为 explicit,任何准入模式都放行', () => {
    for (const admission of ['explicit', 'candidates', 'ignore'] as const) {
      const v = gateJdmeMessage({ isDm: true, groupAllowed: true, atRobot: false, admission })
      if (admission !== 'ignore') {
        expect(v.pass).toBe(true)
        expect(v.strength).toBe('explicit')
        expect(v.basis).toBe('addressed')
      } else {
        expect(v.pass).toBe(false)
        expect(v.basis).toBe('off')
      }
    }
  })

  it('explicit 模式:群聊未@过滤,白名单外过滤', () => {
    const v1 = gateJdmeMessage({ isDm: false, groupAllowed: true, atRobot: false, admission: 'explicit' })
    expect(v1.pass).toBe(false)
    expect(v1.strength).toBe('filtered')
    const v2 = gateJdmeMessage({ isDm: false, groupAllowed: false, atRobot: true, admission: 'explicit' })
    expect(v2.pass).toBe(false)
    expect(v2.basis).toBe('whitelist')
  })

  it('群聊 @机器人 = explicit(addressed)', () => {
    const v = gateJdmeMessage({ isDm: false, groupAllowed: true, atRobot: true, admission: 'explicit' })
    expect(v.pass).toBe(true)
    expect(v.strength).toBe('explicit')
    expect(v.basis).toBe('addressed')
  })

  it('candidates 观察模式:未@也放行为 inferred 候选', () => {
    const v = gateJdmeMessage({ isDm: false, groupAllowed: true, atRobot: false, admission: 'candidates' })
    expect(v.pass).toBe(true)
    expect(v.strength).toBe('inferred')
    expect(v.basis).toBe('admission')
  })

  it('ignore:整源停收,连私聊也拦', () => {
    const v = gateJdmeMessage({ isDm: true, groupAllowed: true, atRobot: true, admission: 'ignore' })
    expect(v.pass).toBe(false)
    expect(v.strength).toBe('filtered')
    expect(v.basis).toBe('off')
  })
})

// ── P6:isPureGreeting 确定性寒暄(替换 LLM 分诊抖动) ──
import { isPureGreeting } from '../../agent/events/triage-filter.js'

describe('isPureGreeting(寒暄确定性静默)', () => {
  it('纯问候恒定为真(含标点/空白尾巴)', () => {
    for (const t of ['hi', 'HI', '你好', '在吗?', '早上好!', '哈喽~', 'hello  ', '晚安。']) {
      expect(isPureGreeting(t), t).toBe(true)
    }
  })

  it('带任何实质内容的不是寒暄(不被静默)', () => {
    for (const t of ['hi jarvis', '你好,帮我查个事', '在吗?在的话派个任务', '你好呀,昨天方案咋样了']) {
      expect(isPureGreeting(t), t).toBe(false)
    }
  })

  it('空串不是寒暄(交回原逻辑)', () => {
    expect(isPureGreeting('')).toBe(false)
  })
})
