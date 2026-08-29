import { describe, expect, it, vi } from 'vitest'
import { classRank, countdown, daysFromToday, formatDate, percent } from './format'

describe('asset formatting', () => {
  it('renders a missing hit rate as null so the page can say 未验证 instead of 0%', () => {
    expect(percent(null)).toBe(null)
    expect(percent(0)).toBe('0%')
    expect(percent(0.456)).toBe('46%')
  })

  it('counts down to a frozen ladder date without drifting on the day boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T23:30:00Z'))
    expect(daysFromToday('2026-08-29')).toBe(0)
    expect(countdown('2026-08-29')).toBe('今天到期')
    expect(countdown('2026-08-30')).toBe('明天到期')
    expect(countdown('2026-09-10')).toBe('12 天后')
    expect(countdown('2026-08-19')).toBe('已过期 10 天')
    expect(countdown('2026-12-31')).toBe('4 个月后')
    expect(countdown(null)).toBe('日期未知')
    vi.useRealTimers()
  })

  it('accepts both date-only ladder labels and full timestamps', () => {
    expect(formatDate('2026-08-27')).toBe('08/27')
    expect(formatDate('2026-08-27T12:00:00Z', true)).toBe('2026/08/27')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('orders classes so indices and sectors come before single names', () => {
    expect(classRank('index')).toBeLessThan(classRank('stock'))
    expect(classRank('etf')).toBeLessThan(classRank('stock'))
    expect(classRank(null)).toBeGreaterThan(classRank('preipo'))
  })
})
