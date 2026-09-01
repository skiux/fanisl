import { baseOf, priceOf } from './prices'
import type {
  Fill, HistoryQuery, Order, OrderKind, OrderList, OrderSide, OrderStatus,
  OrdersSnapshot, OrderVenue, PositionSide, SourceState,
} from './types'

type RawOrder = {
  venue: OrderVenue
  symbol: string
  side: OrderSide
  kind: OrderKind
  qty: number
  filled?: number
  price?: number
  stop?: number
  trigger?: 'mark' | 'last'
  callback?: number
  activate?: number
  tif?: Order['time_in_force']
  reduceOnly?: boolean
  closePosition?: boolean
  positionSide?: PositionSide
  /** OCO/OTO 组号 */
  list?: string
  status?: OrderStatus
  /** 下单于多少分钟前 */
  ageMin: number
  /** 最后一次变动于多少分钟前；不填等于下单时刻 */
  touchedMin?: number
}

/**
 * 当前挂单。合约那几条全是给现有仓位配的止盈止损，与资产页的四笔永续持仓对得上；
 * 现货只有 BNB —— 这个账户的现货就只做 BNB。它们决定了资产页「挂单占用」的数字，
 * 见下面的 spotLockedByAsset。
 */
const RAW_OPEN: RawOrder[] = [
  { venue: 'spot', symbol: 'BNBUSDT', side: 'buy', kind: 'limit', qty: 3, filled: 1.2, price: 640, tif: 'GTC', status: 'partially_filled', ageMin: 2860, touchedMin: 412 },
  { venue: 'spot', symbol: 'BNBUSDT', side: 'sell', kind: 'limit_maker', qty: 2, price: 760, tif: 'GTC', list: 'oco-bnb-1', ageMin: 982 },
  { venue: 'spot', symbol: 'BNBUSDT', side: 'sell', kind: 'stop', qty: 2, stop: 620, price: 615, trigger: 'last', tif: 'GTC', list: 'oco-bnb-1', ageMin: 982 },

  { venue: 'usdm', symbol: 'NVDAUSDT', side: 'sell', kind: 'limit', qty: 38, price: 242, tif: 'GTC', reduceOnly: true, positionSide: 'both', ageMin: 1424 },
  { venue: 'usdm', symbol: 'QQQUSDT', side: 'sell', kind: 'limit', qty: 14, price: 648, tif: 'GTC', reduceOnly: true, positionSide: 'both', ageMin: 764 },

  { venue: 'usdm', symbol: 'NVDAUSDT', side: 'sell', kind: 'stop_market', qty: 38, stop: 190, trigger: 'mark', closePosition: true, positionSide: 'both', ageMin: 4212 },
  { venue: 'usdm', symbol: 'QQQUSDT', side: 'sell', kind: 'stop_market', qty: 14, stop: 572, trigger: 'mark', closePosition: true, positionSide: 'both', ageMin: 2641 },
  { venue: 'usdm', symbol: 'XAUUSDT', side: 'sell', kind: 'trailing_stop_market', qty: 1.8, activate: 4300, callback: 0.015, trigger: 'mark', reduceOnly: true, positionSide: 'both', ageMin: 318 },
  // 空头的止损是买入
  { venue: 'usdm', symbol: 'MSTRUSDT', side: 'buy', kind: 'stop_market', qty: 9, stop: 372, trigger: 'mark', closePosition: true, positionSide: 'both', ageMin: 5921 },

  { venue: 'margin', symbol: 'BNBUSDT', side: 'buy', kind: 'limit', qty: 1.5, price: 655, tif: 'GTC', ageMin: 8104 },
]

/**
 * 挂单占用的仓位，按资产汇总。资产页的「挂单占用」直接用它，
 * 两页因此不会各报一个数。OCO 一组只锁一次——组内两条挂的是同一批币。
 */
export const spotLockedByAsset: Record<string, number> = (() => {
  const acc: Record<string, number> = {}
  const counted = new Set<string>()
  for (const row of RAW_OPEN) {
    if (row.venue !== 'spot') continue
    if (row.list) {
      if (counted.has(row.list)) continue
      counted.add(row.list)
    }
    const remaining = row.qty - (row.filled ?? 0)
    if (row.side === 'buy') {
      const quote = row.price ?? row.stop ?? 0
      acc.USDT = (acc.USDT ?? 0) + remaining * quote
    } else {
      const base = baseOf(row.symbol)
      acc[base] = (acc[base] ?? 0) + remaining
    }
  }
  return acc
})()

const iso = (asOf: Date, minutesAgo: number) =>
  new Date(asOf.getTime() - minutesAgo * 60_000).toISOString()

function toOrder(row: RawOrder, index: number, asOf: Date): Order {
  const remaining = row.qty - (row.filled ?? 0)
  const reference = priceOf(row.symbol)
  const level = row.price ?? row.stop ?? row.activate ?? reference
  return {
    id: `${row.venue}:${4_100_000 + index * 137}`,
    venue: row.venue,
    symbol: row.symbol,
    side: row.side,
    kind: row.kind,
    status: row.status ?? 'new',
    price: row.price ?? null,
    stop_price: row.stop ?? null,
    trigger_by: row.trigger ?? null,
    callback_rate: row.callback ?? null,
    activate_price: row.activate ?? null,
    orig_qty: row.qty,
    executed_qty: row.filled ?? 0,
    // 名义价值按剩余未成交的部分算——已经成交的那部分不再占用任何东西
    notional_usd: level === null ? null : remaining * level,
    time_in_force: row.tif ?? null,
    good_till_date: null,
    reduce_only: row.reduceOnly ?? false,
    close_position: row.closePosition ?? false,
    position_side: row.positionSide ?? null,
    order_list_id: row.list ?? null,
    reference_price: reference,
    created_at: iso(asOf, row.ageMin),
    updated_at: iso(asOf, row.touchedMin ?? row.ageMin),
  }
}

export function buildOpenOrders(asOf: Date): Order[] {
  return RAW_OPEN.map((row, index) => toOrder(row, index, asOf))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function buildOrderLists(asOf: Date): OrderList[] {
  const members = buildOpenOrders(asOf).filter((order) => order.order_list_id === 'oco-bnb-1')
  if (members.length === 0) return []
  return [{
    id: 'oco-bnb-1',
    venue: 'spot',
    symbol: 'BNBUSDT',
    contingency: 'OCO',
    status: 'executing',
    order_ids: members.map((order) => order.id),
    created_at: members[0].created_at,
  }]
}

/* ---------------- 历史：只能按交易对查，这里给 BTCUSDT 合约的一段 ---------------- */

const HISTORY_SYMBOL = 'NVDAUSDT'

const RAW_HISTORY: RawOrder[] = [
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'buy', kind: 'limit', qty: 22, filled: 22, price: 203.8, tif: 'GTC', status: 'filled', ageMin: 9702 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'buy', kind: 'limit', qty: 16, filled: 16, price: 206.15, tif: 'GTC', status: 'filled', ageMin: 9695 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'sell', kind: 'limit', qty: 10, price: 228, tif: 'GTC', status: 'canceled', ageMin: 7204, touchedMin: 6980 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'buy', kind: 'limit', qty: 8, filled: 8, price: 209.45, tif: 'GTC', status: 'filled', ageMin: 6103 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'sell', kind: 'limit', qty: 6, price: 221.5, tif: 'GTX', status: 'expired', ageMin: 5406 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'sell', kind: 'stop_market', qty: 38, stop: 192, trigger: 'mark', closePosition: true, status: 'canceled', ageMin: 4802, touchedMin: 4212 },
  { venue: 'usdm', symbol: HISTORY_SYMBOL, side: 'sell', kind: 'limit', qty: 12, filled: 8, price: 215, tif: 'GTC', status: 'canceled', ageMin: 3302, touchedMin: 3120 },
]

export function buildHistory(asOf: Date): Order[] {
  return RAW_HISTORY.map((row, index) => toOrder(row, index + 90, asOf))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** U 本位费率：挂单 0.02%，吃单 0.04% */
const FEE = { maker: 0.0002, taker: 0.0004 }

type RawFill = { side: OrderSide; qty: number; price: number; maker: boolean; ageMin: number; orderIndex: number }

const RAW_FILLS: RawFill[] = [
  { side: 'buy', qty: 22, price: 203.8, maker: true, ageMin: 9702, orderIndex: 0 },
  { side: 'buy', qty: 16, price: 206.15, maker: false, ageMin: 9695, orderIndex: 1 },
  { side: 'buy', qty: 8, price: 209.45, maker: false, ageMin: 6103, orderIndex: 3 },
  { side: 'sell', qty: 5, price: 215.4, maker: false, ageMin: 3302, orderIndex: 6 },
  { side: 'sell', qty: 3, price: 216.8, maker: true, ageMin: 3120, orderIndex: 6 },
]

/**
 * 开仓均价由成交记录反解，而不是在持仓那边另写一个数——持仓的 entryPrice
 * 本来就是这些买入成交的加权平均，两处各写一遍迟早对不上。
 */
export const NVDA_ENTRY_PRICE = (() => {
  const buys = RAW_FILLS.filter((row) => row.side === 'buy')
  const qty = buys.reduce((sum, row) => sum + row.qty, 0)
  return qty === 0 ? 0 : buys.reduce((sum, row) => sum + row.qty * row.price, 0) / qty
})()

export function buildFills(asOf: Date): Fill[] {
  return RAW_FILLS.map((row, index) => {
    const quote = row.qty * row.price
    return {
      id: `usdm:t${820_400 + index * 29}`,
      order_id: `usdm:${4_100_000 + (row.orderIndex + 90) * 137}`,
      venue: 'usdm' as OrderVenue,
      symbol: HISTORY_SYMBOL,
      side: row.side,
      price: row.price,
      qty: row.qty,
      quote_qty: quote,
      commission: quote * (row.maker ? FEE.maker : FEE.taker),
      commission_asset: 'USDT',
      is_maker: row.maker,
      // 只有平仓的那一边结算盈亏；开仓成交的 realizedPnl 是 0
      realized_pnl: row.side === 'sell' ? (row.price - NVDA_ENTRY_PRICE) * row.qty : 0,
      time: iso(asOf, row.ageMin),
    }
  }).sort((a, b) => b.time.localeCompare(a.time))
}

/** 可查历史的交易对：有挂单的 + 有持仓的 + 现货余额能配出的 */
export const HISTORY_SYMBOLS = [
  'NVDAUSDT', 'QQQUSDT', 'XAUUSDT', 'MSTRUSDT', 'BNBUSDT',
]

export function buildQuery(asOf: Date): HistoryQuery {
  return {
    symbol: HISTORY_SYMBOL,
    venue: 'usdm',
    from: iso(asOf, 7 * 24 * 60),
    to: asOf.toISOString(),
    // /fapi/v1/allOrders：单次区间 < 7 天，最多回溯 90 天
    max_window_hours: 7 * 24,
    lookback_days: 90,
  }
}

export const ORDER_SOURCE_KEYS = [
  'spot_open', 'futures_open', 'margin_open', 'order_lists', 'algo_open',
  'order_history', 'trade_history',
] as const

export function buildOrdersSnapshot(asOf: Date): OrdersSnapshot {
  const at = asOf.toISOString()
  return {
    as_of: at,
    sources: ORDER_SOURCE_KEYS.map((key): SourceState => ({
      key, status: 'ok', as_of: at, detail: null,
    })),
    open: buildOpenOrders(asOf),
    order_lists: buildOrderLists(asOf),
    history_symbols: HISTORY_SYMBOLS,
    query: buildQuery(asOf),
    history: buildHistory(asOf),
    fills: buildFills(asOf),
  }
}
