import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseOf, clockTime, price, splitPair } from './format'

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
  afterEach(() => vi.useRealTimers())

  it('按美东时间显示，并跟随夏令时', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
    expect(clockTime('2026-09-05T13:30:00Z')).toBe('09:30')
    expect(clockTime('2026-09-05T02:30:00Z')).toBe('09-04 22:30')

    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    expect(clockTime('2026-01-05T13:30:00Z')).toBe('08:30')
  })

  it('是否显示日期也按美东自然日判断', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T02:45:00Z')) // 美东 09-04 22:45
    expect(clockTime('2026-09-05T01:30:00Z')).toBe('21:30')
    expect(clockTime('2026-09-05T04:30:00Z')).toBe('09-05 00:30')
  })

  it('取不到就是取不到', () => {
    expect(clockTime(null)).toBe('—')
  })
})

describe('splitPair', () => {
  it('拆得出非 USDT 计价的对', () => {
    expect(splitPair('BTCUSDT')).toEqual({ base: 'BTC', quote: 'USDT' })
    expect(splitPair('ETHBTC')).toEqual({ base: 'ETH', quote: 'BTC' })
  })

  it('认不出计价币就整个当标的，不瞎切', () => {
    expect(splitPair('WEIRD')).toEqual({ base: 'WEIRD', quote: null })
    // 计价币本身不能被切成空标的
    expect(splitPair('USDT')).toEqual({ base: 'USDT', quote: null })
  })

  it('和 baseOf 是两件事，不能互相替换', () => {
    // baseOf 的结果还被当成"美元报价的键"用（prices.ts）。ETHBTC 拆成 ETH
    // 那边就会拿 ETH 的美元价当成 ETH/BTC 的价格，静悄悄地错。
    expect(baseOf('ETHBTC')).toBe('ETHBTC')
    expect(splitPair('ETHBTC').base).toBe('ETH')
  })
})
