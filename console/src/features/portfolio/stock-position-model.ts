import { compareBy, type SortKey, type SortState } from '../../components/controls'
import type { StockPosition, StocksAccount } from '../../api/types'

export type StockSort = 'value' | 'pnl' | 'cost' | 'symbol'

export const STOCK_SORT_KEYS: SortKey<StockSort>[] = [
  { value: 'value', label: '市值', initial: 'desc' },
  { value: 'pnl', label: '未实现', initial: 'desc' },
  { value: 'cost', label: '成本', initial: 'desc' },
  { value: 'symbol', label: '标的', initial: 'asc' },
]

const VALUE: Record<Exclude<StockSort, 'symbol'>, (row: StockPosition) => number | null> = {
  value: (row) => row.wallet_value_usd,
  pnl: (row) => row.unrealized_pnl_usd,
  cost: (row) => row.cost_basis_usd,
}

export function sortStockPositions(rows: StockPosition[], sort: SortState<StockSort>) {
  const out = [...rows]
  if (sort.key === 'symbol') {
    out.sort((a, b) => (sort.direction === 'asc' ? 1 : -1)
      * a.symbol.localeCompare(b.symbol))
  } else {
    const pick = VALUE[sort.key]
    out.sort((a, b) => compareBy(pick(a), pick(b), sort.direction))
  }
  return out
}

export function stockTotals(stocks: StocksAccount) {
  const directRows = stocks.equity_holdings
  const tokenizedRows = stocks.tokenized_assets
  const direct = directRows.every((row) => row.value_usd !== null)
    ? directRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0) : null
  const tokenized = tokenizedRows.every((row) => row.value_usd !== null)
    ? tokenizedRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0) : null
  const holdings = [...directRows, ...tokenizedRows]
  const valued = holdings.filter((row) => row.value_usd !== null)
  const reconciled = stocks.positions.filter((row) => row.cost_status === 'reconciled')
  const withPnl = stocks.positions.filter((row) => row.unrealized_pnl_usd !== null)
  return {
    direct,
    tokenized,
    total: direct !== null && tokenized !== null ? direct + tokenized : null,
    knownValue: valued.reduce((sum, row) => sum + (row.value_usd ?? 0), 0),
    valuedCount: valued.length,
    holdingCount: holdings.length,
    knownCost: reconciled.length > 0
      ? reconciled.reduce((sum, row) => sum + (row.cost_basis_usd ?? 0), 0) : null,
    knownPnl: withPnl.length > 0
      ? withPnl.reduce((sum, row) => sum + (row.unrealized_pnl_usd ?? 0), 0) : null,
    pnlCount: withPnl.length,
    quoteCount: stocks.positions.filter((row) => row.bid_usd !== null && row.ask_usd !== null).length,
  }
}
