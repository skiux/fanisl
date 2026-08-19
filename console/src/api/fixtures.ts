import type { Balance, PortfolioSnapshot, Position, VenueState } from './types'

/**
 * 示例数据按真实 ccxt `fetch_balance()` / `fetch_positions()` 的形状编：
 * 几十个币种、绝大多数是灰尘余额、free/used 分开、部分币种取不到价。
 * 照"5 条干净持仓"编出来的界面，真数据一进来就会崩。
 */

type Holding = { asset: string; free: number; used: number; price: number | null }

const SPOT: Holding[] = [
  { asset: 'USDT', free: 12480.33, used: 1150.0, price: 1.0002 },
  { asset: 'BTC', free: 0.18426, used: 0, price: 94180.22 },
  { asset: 'ETH', free: 3.2087, used: 0.4, price: 3142.68 },
  { asset: 'SOL', free: 41.73, used: 0, price: 187.44 },
  { asset: 'BNB', free: 6.842, used: 0, price: 682.15 },
  { asset: 'LINK', free: 128.4, used: 0, price: 21.77 },
  { asset: 'ARB', free: 906.2, used: 0, price: 0.7431 },
  // ↓ 灰尘：真账户里这一段永远是最长的
  { asset: 'SHIB', free: 812400, used: 0, price: 0.00001842 },
  { asset: 'XRP', free: 3.1408, used: 0, price: 2.5813 },
  { asset: 'DOGE', free: 21.86, used: 0, price: 0.3394 },
  { asset: 'ADA', free: 9.607, used: 0, price: 0.6502 },
  { asset: 'AVAX', free: 0.2841, used: 0, price: 34.92 },
  { asset: 'LTC', free: 0.01423, used: 0, price: 103.47 },
  { asset: 'ATOM', free: 0.3187, used: 0, price: 4.4612 },
  { asset: 'DOT', free: 0.4102, used: 0, price: 3.8871 },
  { asset: 'FIL', free: 0.2237, used: 0, price: 3.5104 },
  { asset: 'NEAR', free: 0.0916, used: 0, price: 4.6238 },
  { asset: 'ALGO', free: 2.7043, used: 0, price: 0.2261 },
  { asset: 'VET', free: 11.208, used: 0, price: 0.02784 },
  { asset: 'TRX', free: 1.9046, used: 0, price: 0.2617 },
  { asset: 'LUNC', free: 44210, used: 0, price: 0.00000091 },
  // 取不到价：已下架 / 无 USDT 交易对。price=null，不能当 0 处理
  { asset: 'BETH', free: 0.0044, used: 0, price: null },
  { asset: 'PAXG', free: 0.00071, used: 0, price: null },
]

const FUTURES_WALLET: Holding[] = [
  { asset: 'USDT', free: 6208.41, used: 2212.25, price: 1.0002 },
]

function toBalance(h: Holding, venue: 'spot' | 'futures'): Balance {
  const total = h.free + h.used
  return {
    asset: h.asset,
    venue,
    free: h.free,
    used: h.used,
    total,
    price_usd: h.price,
    value_usd: h.price === null ? null : total * h.price,
  }
}

export const balances: Balance[] = [
  ...SPOT.map((h) => toBalance(h, 'spot')),
  ...FUTURES_WALLET.map((h) => toBalance(h, 'futures')),
]

export const positions: Position[] = [
  {
    symbol: 'BTC/USDT:USDT',
    side: 'long',
    contracts: 0.244,
    notional_usd: 22979.97,
    entry_price: 91406.5,
    mark_price: 94180.22,
    liquidation_price: 71284.16,
    leverage: 5,
    margin_mode: 'cross',
    unrealized_pnl_usd: 676.79,
    initial_margin_usd: 4595.99,
  },
  {
    symbol: 'ETH/USDT:USDT',
    side: 'short',
    contracts: 2.85,
    notional_usd: 8956.64,
    entry_price: 3081.44,
    mark_price: 3142.68,
    liquidation_price: 3644.02,
    leverage: 3,
    margin_mode: 'isolated',
    unrealized_pnl_usd: -174.53,
    initial_margin_usd: 2985.55,
  },
  {
    symbol: 'SOL/USDT:USDT',
    side: 'long',
    contracts: 18.4,
    notional_usd: 3448.9,
    entry_price: 194.06,
    mark_price: 187.44,
    liquidation_price: 142.71,
    leverage: 4,
    margin_mode: 'cross',
    unrealized_pnl_usd: -121.81,
    initial_margin_usd: 862.23,
  },
]

const okVenue = (venue: 'spot' | 'futures', as_of: string): VenueState => ({
  venue, status: 'ok', as_of, detail: null,
})

function sum(items: Balance[]) {
  return items.reduce((total, item) => total + (item.value_usd ?? 0), 0)
}

export function buildSnapshot(asOf: Date): PortfolioSnapshot {
  const iso = asOf.toISOString()
  const spot = sum(balances.filter((b) => b.venue === 'spot'))
  const futuresWallet = sum(balances.filter((b) => b.venue === 'futures'))
  const upnl = positions.reduce((total, p) => total + p.unrealized_pnl_usd, 0)
  const futures = futuresWallet + upnl
  const equity = spot + futures
  return {
    as_of: iso,
    base_currency: 'USD',
    venues: [okVenue('spot', iso), okVenue('futures', iso)],
    totals: {
      equity_usd: equity,
      spot_usd: spot,
      futures_usd: futures,
      unrealized_pnl_usd: upnl,
      change_24h_usd: 1284.37,
      change_24h_pct: 0.0213,
    },
    balances,
    positions,
    futures_risk: {
      margin_ratio: 0.1873,
      maintenance_margin_usd: 1578.42,
      margin_balance_usd: 8426.13,
    },
  }
}
