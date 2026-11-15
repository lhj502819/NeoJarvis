import { describe, it, expect } from 'vitest'
import { nextFireTime, normalizeScheduleInput } from '../../agent/jarvis/schedule.js'

describe('nextFireTime — 下一次触发时间', () => {
  it('每天:今天还没到点 → 今天;已过点 → 明天', () => {
    const now = new Date('2026-11-10T10:00:00')
    expect(nextFireTime('daily', [], '11:00', now)?.getDate()).toBe(10)
    const next = nextFireTime('daily', [], '09:00', now)!
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('每周:取下一个命中的星期(0=周日)', () => {
    // 2026-11-10 是周二;下一个周一是 11-16
    const now = new Date('2026-11-10T10:00:00')
    const next = nextFireTime('weekly', [1], '09:30', now)!
    expect(next.getDay()).toBe(1)
    expect(next.getDate()).toBe(16)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(30)
  })

  it('每周当天但时间已过 → 顺延到下个星期', () => {
    // 周二 10:00,目标是周二 09:00(已过)→ 下周二 11-17
    const now = new Date('2026-11-10T10:00:00')
    const next = nextFireTime('weekly', [2], '09:00', now)!
    expect(next.getDate()).toBe(17)
  })

  it('每周但没选天 → null(调用方跳过)', () => {
    expect(nextFireTime('weekly', [], '09:00', new Date())).toBeNull()
  })
})

describe('normalizeScheduleInput — 输入校验与归一化', () => {
  it('合法输入:去空白、weekly 天去重排序', () => {
    const r = normalizeScheduleInput({
      name: '  巡检  ', cmd: ' 检查行云 ', time: '10:05', freq: 'weekly', days: [5, 1, 5], enabled: false,
    })
    expect(r.name).toBe('巡检')
    expect(r.cmd).toBe('检查行云')
    expect(r.freq).toBe('weekly')
    expect(r.days).toEqual([1, 5])
    expect(r.enabled).toBe(false)
  })

  it('daily 忽略 days', () => {
    const r = normalizeScheduleInput({ name: 'a', cmd: 'b', time: '09:00', freq: 'daily', days: [3] })
    expect(r.days).toEqual([])
  })

  it('缺名称 / 缺指令 / 时间非法 / 每周没选天 → 抛错', () => {
    expect(() => normalizeScheduleInput({ name: '', cmd: 'x', time: '09:00' })).toThrow('名称')
    expect(() => normalizeScheduleInput({ name: 'x', cmd: ' ', time: '09:00' })).toThrow('指令')
    expect(() => normalizeScheduleInput({ name: 'x', cmd: 'y', time: '25:00' })).toThrow('时间')
    expect(() => normalizeScheduleInput({ name: 'x', cmd: 'y', time: '09:00', freq: 'weekly', days: [] })).toThrow('至少选一天')
  })

  it('默认启用', () => {
    expect(normalizeScheduleInput({ name: 'x', cmd: 'y', time: '09:00' }).enabled).toBe(true)
  })
})
