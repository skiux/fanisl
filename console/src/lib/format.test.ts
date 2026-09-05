import { describe, expect, it } from 'vitest'
import { clockTime, price } from './format'

describe('price', () => {
  it('不用科学计数法印亚分币', () => {
    // toPrecision 在指数 < −6 时会改回科学计数法，LUNC 曾印成 $9.10e-7
    expect(price(9.1e-7)).toBe('$0.00000091')
    expect(price(1.84e-5)).toBe('$0.0000184')
  })

  it('按数量级给位数', () => {
    expect(price(3142.68)).toBe('$3,142.68')   // 上千：整钱，两位
    expect(price(187.44)).toBe('$187.44')
    expect(price(1.04)).toBe('$1.04')
    expect(price(0.743)).toBe('$0.743')        // 一元以下：三位有效数字
  })

  it('取不到就是取不到，不是 $0', () => {
    expect(price(null)).toBe('—')
    expect(price(Number.NaN)).toBe('—')
  })
})

describe('clockTime', () => {
  it('按 UTC 读，不按本地时区', () => {
    // 原先硬编码 Asia/Shanghai，而整页的日切是 UTC——跨零点那几个小时里
    // "截至"与日历会指着不同的一天
    expect(clockTime('2026-09-05T02:30:00Z')).toContain('02:30')
    expect(clockTime('2026-09-04T23:45:00Z')).toContain('23:45')
  })

  it('不是今天就带上日期', () => {
    // "今天"按 UTC 判，与日历同一条边界
    const iso = new Date(Date.now() - 5 * 86_400_000).toISOString()
    expect(clockTime(iso)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('取不到就是取不到', () => {
    expect(clockTime(null)).toBe('—')
  })
})
