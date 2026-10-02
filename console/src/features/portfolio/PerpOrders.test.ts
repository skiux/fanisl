import { describe, expect, it } from 'vitest'
import { fetchOrders } from '../../api/client'
import { futuresOrderRows } from './PerpOrders'

describe('合约页委托', () => {
  it('按账户查询历史，并且只展示合约挂单、历史与成交', async () => {
    const snapshot = await fetchOrders('ok', '', undefined, { venue: 'usdm' })
    const rows = futuresOrderRows(snapshot)

    expect(snapshot.query?.venue).toBe('usdm')
    expect(snapshot.query?.max_window_hours).toBe(168)
    expect(snapshot.query?.lookback_days).toBe(90)
    expect(rows.open).toHaveLength(7)
    expect(rows.history).toHaveLength(7)
    expect(rows.fills).toHaveLength(5)
    expect([...rows.open, ...rows.history, ...rows.fills]
      .every((row) => row.venue === 'usdm')).toBe(true)
  })

  it('合约域名故障时仍保留 sapi 返回的策略单', async () => {
    const snapshot = await fetchOrders('fapi_blocked', '', undefined, { venue: 'usdm' })
    expect(futuresOrderRows(snapshot).open.map((order) => order.kind)).toEqual(['twap'])
  })
})
