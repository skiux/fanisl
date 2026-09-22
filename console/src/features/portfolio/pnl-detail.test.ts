import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { signedMoney } from '../../lib/format'
import { PnlDetail } from './PnlDetail'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function render(pnl: ReturnType<typeof buildSnapshot>['pnl']) {
  act(() => root.render(createElement(PnlDetail, {
    topic: 'today' as const, pnl, onClose: () => {},
  })))
  // Radix 的弹层渲染在 portal 里，不在 host 下面
  return document.body.textContent ?? ''
}

const snapshot = () => buildSnapshot(new Date('2026-09-19T12:00:00Z'))

describe('今日盈亏明细', () => {
  it('一条一条平铺，不再有分组标题与两层小计', () => {
    const text = render(snapshot().pnl)
    expect(text).not.toContain('现货涨跌')
    expect(text).not.toContain('当日结算')
    expect(text).toContain('合计')
    expect(text).toContain('BTC')
    expect(text).toContain('已实现盈亏')
  })

  it('逐币那一行给现价与涨跌幅，不给"昨收 → 现价"那对箭头', () => {
    const text = render(snapshot().pnl)
    expect(text).not.toContain('→')
    expect(text).toMatch(/0\.116797 · \$94,180\.22 · [+−]/)
  })

  it('正股与理财都在里面：一个是持仓涨跌，一个是派息', () => {
    const pnl = snapshot().pnl!
    const text = render(pnl)
    expect(text).toContain('SOXL')
    expect(text).toContain('理财派息')
    expect(text).toContain('杠杆利息')
    expect(text).toContain(signedMoney(pnl.today.earn_usd))
    // 正股的昨收不来自 Binance，出处要写出来
    expect(text).toContain(pnl.equity_close_source)
  })

  it('取不到昨收的股票被点名，而不是悄悄少一块', () => {
    const base = snapshot().pnl!
    const text = render({ ...base, stock_marks: [], equity_missing: ['SOXL'] })
    expect(text).toContain('SOXL 取不到昨收')
  })

  it('合计就是接口给的那个数，不在前端另加一遍', () => {
    const pnl = snapshot().pnl!
    expect(render(pnl)).toContain(signedMoney(pnl.today.total_usd))
  })
})
