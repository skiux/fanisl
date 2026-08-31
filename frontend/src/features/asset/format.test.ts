import { describe, expect, it, vi } from 'vitest'
import {
  claimHeadline, classRank, countdown, daysFromToday, formatDate, industryLabel,
  percent, rateDisplay,
} from './format'

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

  it('样本 <10 给计数而不是百分比——"100% n=9" 读者拿到的是错的印象', () => {
    expect(rateDisplay({ scored: 9, hits: 9, partials: 0, misses: 0, hit_rate: 1 }))
      .toMatchObject({ text: '9 中', isRate: false, small: true })
    expect(rateDisplay({ scored: 1, hits: 1, partials: 0, misses: 0, hit_rate: 1 }))
      .toMatchObject({ text: '1 中', isRate: false })
    expect(rateDisplay({ scored: 5, hits: 3, partials: 0, misses: 2, hit_rate: 0.6 }))
      .toMatchObject({ text: '3 中 · 2 错', isRate: false })
    // 10 起才折算，并带 n
    expect(rateDisplay({ scored: 27, hits: 14, partials: 3, misses: 10, hit_rate: 0.574 }))
      .toMatchObject({ text: '57%', isRate: true, small: false })
    expect(rateDisplay({ scored: 0, hits: 0, partials: 0, misses: 0, hit_rate: null }))
      .toMatchObject({ text: '未验证', isRate: false })
  })

  it('行业名映射成中文，顺带治 SIC 的荒谬标签', () => {
    expect(industryLabel('SEMICONDUCTORS & RELATED DEVICES')).toBe('半导体')
    expect(industryLabel('SERVICES-VIDEO TAPE RENTAL')).toBe('流媒体')   // 奈飞 1997 年注册时填的
    expect(industryLabel('Semiconductors')).toBe('半导体')               // Finnhub 那套词汇
    expect(industryLabel('SOMETHING NOT MAPPED')).toBe('Something not mapped')
    expect(industryLabel(null)).toBe(null)
  })

  it('判断压成可扫的一行：标的往哪、过哪个数', () => {
    expect(claimHeadline({ direction: 'up', magnitude: { target: 250 } })).toBe('看涨 ↑ · 目标 250')
    expect(claimHeadline({ direction: 'range', magnitude: { low: 4000, high: 4700 } }))
      .toBe('区间 ↔ · 下界 4000 · 上界 4700')
    expect(claimHeadline({ claim_class: 'relative' })).toBe('相对强弱')
    expect(claimHeadline({ direction: 'down', condition_text: '若跌破 150 则继续看空' }))
      .toBe('看跌 ↓ · 条件：若跌破 150 则继续看空')
  })
})
