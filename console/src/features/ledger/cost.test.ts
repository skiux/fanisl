import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLedgerSnapshot } from '../../api/ledger-fixtures'
import { signedMoney } from '../../lib/format'
import type { LedgerSnapshot } from '../../api/types'
import { LedgerStrip } from './LedgerStrip'
import { costBySymbol, filterEntries, LedgerView } from './views'

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

const snapshot = () => buildLedgerSnapshot(new Date('2026-09-30T12:00:00Z'), 30)
const sum = (rows: { value_usd: number | null }[]) => rows.reduce((total, row) => total + (row.value_usd ?? 0), 0)

describe('流水页的成本统计', () => {
  it('成本只收持仓要付的那几类：资金费、手续费、杠杆利息，返佣抵扣；已实现盈亏不算', () => {
    const kinds = new Set(filterEntries(snapshot().entries, 'cost').map((row) => row.kind))
    expect(kinds).toEqual(new Set(['funding_fee', 'commission', 'referral_kickback', 'margin_interest']))
  })

  it('按标的拆：资金费与手续费归到交易对，利息按借的币，返佣单列', () => {
    const rows = costBySymbol(snapshot().entries)
    const labels = rows.map((row) => row.label)
    expect(labels).toContain('NVDA')
    expect(labels).toContain('返佣')
    expect(labels.some((label) => label.startsWith('利息 · '))).toBe(true)
    // 各行加起来就是全部成本，不多不少
    const total = sum(filterEntries(snapshot().entries, 'cost'))
    expect(rows.reduce((acc, row) => acc + row.usd, 0)).toBeCloseTo(total)
    // 大的在前
    expect(Math.abs(rows[0].usd)).toBeGreaterThanOrEqual(Math.abs(rows[rows.length - 1].usd))
  })

  it('「成本」那一页给合计、日均与四类的拆分，右栏按标的', () => {
    const snap = snapshot()
    act(() => root.render(createElement(LedgerView, { snapshot: snap, filter: 'cost' })))
    const text = host.textContent ?? ''
    const total = sum(filterEntries(snap.entries, 'cost'))
    expect(text).toContain(signedMoney(total))
    expect(text).toContain(signedMoney(total / snap.window.days))
    for (const label of ['合计', '日均', '资金费', '手续费', '返佣', '杠杆利息', '按标的']) {
      expect(text).toContain(label)
    }
    expect(text).not.toContain('按类型')
  })

  it('摘要条常驻一格本期成本；供数的来源没取到时变灰', () => {
    const snap = snapshot()
    act(() => root.render(createElement(LedgerStrip, { snapshot: snap })))
    expect(host.textContent).toContain('本期成本')
    expect(host.textContent).toContain(signedMoney(sum(filterEntries(snap.entries, 'cost'))))

    const partial: LedgerSnapshot = {
      ...snap,
      sources: snap.sources.map((source) => source.key === 'margin_interest'
        ? { ...source, status: 'unreachable' as const } : source),
    }
    act(() => root.render(createElement(LedgerStrip, { snapshot: partial })))
    const cell = [...host.querySelectorAll('*')]
      .find((node) => node.children.length === 0 && node.textContent === '本期成本')!
      .parentElement!
    expect(cell.innerHTML).toContain('text-ink-3')
  })
})
