import { PRICE } from './prices'
import { spotLockedByAsset } from './orders-fixtures'
import type {
  Attribution, EarnPosition, EquityPoint, FuturesAccount, FuturesPosition,
  IncomeBreakdown, MarginAccount, PortfolioSnapshot, SourceState, SpotAsset,
  Transfers, WalletBucket,
} from './types'

/** locked（挂单占用）不在这里写死，由委托 fixture 反推，两页的数对得上 */
type RawSpot = { asset: string; free: number; freeze?: number; withdrawing?: number }

const RAW_SPOT: RawSpot[] = [
  { asset: 'USDT', free: 8240.16, withdrawing: 500 },
  { asset: 'BTC', free: 0.18426 },
  { asset: 'SOL', free: 41.73 },
  { asset: 'ETH', free: 1.6087 },
  { asset: 'BNB', free: 4.212 },
  { asset: 'LINK', free: 128.4 },
  { asset: 'ARB', free: 906.2, freeze: 120 },
  { asset: 'SHIB', free: 812400 }, { asset: 'XRP', free: 3.1408 },
  { asset: 'DOGE', free: 21.86 }, { asset: 'ADA', free: 9.607 },
  { asset: 'AVAX', free: 0.2841 }, { asset: 'LTC', free: 0.01423 },
  { asset: 'ATOM', free: 0.3187 }, { asset: 'DOT', free: 0.4102 },
  { asset: 'FIL', free: 0.2237 }, { asset: 'NEAR', free: 0.0916 },
  { asset: 'ALGO', free: 2.7043 }, { asset: 'VET', free: 11.208 },
  { asset: 'TRX', free: 1.9046 }, { asset: 'LUNC', free: 44210 },
  { asset: 'BETH', free: 0.0044 }, { asset: 'PAXG', free: 0.00071 },
]

export const spot: SpotAsset[] = RAW_SPOT.map((row) => {
  const locked = spotLockedByAsset[row.asset] ?? 0
  const freeze = row.freeze ?? 0
  const withdrawing = row.withdrawing ?? 0
  const total = row.free + locked + freeze + withdrawing
  const priceUsd = PRICE[row.asset] ?? null
  return {
    asset: row.asset, free: row.free, locked, freeze, withdrawing, total,
    price_usd: priceUsd,
    value_usd: priceUsd === null ? null : total * priceUsd,
  }
})

type RawPosition = Omit<FuturesPosition, 'notional_usd' | 'unrealized_pnl_usd' | 'liq_distance' | 'mark_price'>
  & { base: string }

const RAW_POSITIONS: RawPosition[] = [
  {
    base: 'BTC', symbol: 'BTCUSDT', position_side: 'both', position_amt: 0.244,
    entry_price: 91406.5, liquidation_price: 71284.16, leverage: 5, isolated: false,
    initial_margin_usd: 4595.99, maint_margin_usd: 918.4, adl_quantile: 1,
  },
  {
    base: 'ETH', symbol: 'ETHUSDT', position_side: 'both', position_amt: -2.85,
    entry_price: 3081.44, liquidation_price: 3644.02, leverage: 3, isolated: true,
    initial_margin_usd: 2985.55, maint_margin_usd: 447.83, adl_quantile: 3,
  },
  {
    base: 'SOL', symbol: 'SOLUSDT', position_side: 'both', position_amt: 18.4,
    entry_price: 194.06, liquidation_price: 142.71, leverage: 4, isolated: false,
    initial_margin_usd: 862.23, maint_margin_usd: 172.45, adl_quantile: 2,
  },
]

export const positions: FuturesPosition[] = RAW_POSITIONS.map((row) => {
  const mark = PRICE[row.base] as number
  const { base: _base, ...rest } = row
  const liq = row.liquidation_price
  return {
    ...rest,
    mark_price: mark,
    notional_usd: Math.abs(row.position_amt) * mark,
    unrealized_pnl_usd: (mark - row.entry_price) * row.position_amt,
    liq_distance: liq === null ? null : Math.abs(mark - liq) / mark,
  }
})

const FUTURES_WALLET = 8426.13

export const futures: FuturesAccount = (() => {
  const upnl = positions.reduce((sum, p) => sum + p.unrealized_pnl_usd, 0)
  const marginBalance = FUTURES_WALLET + upnl
  const initial = positions.reduce((sum, p) => sum + p.initial_margin_usd, 0)
  const maint = positions.reduce((sum, p) => sum + p.maint_margin_usd, 0)
  return {
    dual_side_position: false,
    multi_assets_margin: false,
    total_wallet_balance: FUTURES_WALLET,
    total_margin_balance: marginBalance,
    total_unrealized_pnl: upnl,
    total_initial_margin: initial,
    total_maint_margin: maint,
    available_balance: marginBalance - initial,
    max_withdraw: marginBalance - initial,
    margin_ratio: marginBalance > 0 ? maint / marginBalance : null,
    positions,
  }
})()

export const earn: EarnPosition[] = [
  {
    product_id: 'USDT001', asset: 'USDT', amount: 6500, value_usd: 6500 * 1.0002,
    kind: 'flexible', apr: 0.0482, cumulative_rewards: 128.44,
    cumulative_rewards_usd: 128.44 * 1.0002,
    redeem_date: null, can_redeem: true,
  },
  {
    product_id: 'ETH001', asset: 'ETH', amount: 1.2, value_usd: 1.2 * 3142.68,
    kind: 'flexible', apr: 0.0194, cumulative_rewards: 0.0071,
    cumulative_rewards_usd: 0.0071 * 3142.68,
    redeem_date: null, can_redeem: true,
  },
  {
    product_id: 'SOL90D', asset: 'SOL', amount: 25, value_usd: 25 * 187.44,
    kind: 'locked', apr: 0.085, cumulative_rewards: 0.4128,
    cumulative_rewards_usd: 0.4128 * 187.44,
    redeem_date: '2026-09-14', can_redeem: false,
  },
]

export const margin: MarginAccount = {
  margin_level: 1.8134,
  total_asset_usd: 9412.55,
  total_liability_usd: 5205.67,
  total_net_asset_usd: 4206.88,
}

const FUNDING_WALLET = 1842.3
const COINM_WALLET = 1204.66

export const wallets: WalletBucket[] = (() => {
  const spotValue = spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const earnValue = earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const bucket = (kind: WalletBucket['kind'], value: number, activate = true): WalletBucket => ({
    kind, value_usd: value, btc_valuation: value / (PRICE.BTC as number), activate,
  })
  return [
    bucket('spot', spotValue),
    bucket('usdm_futures', futures.total_margin_balance),
    bucket('earn', earnValue),
    bucket('cross_margin', margin.total_net_asset_usd),
    bucket('funding', FUNDING_WALLET),
    bucket('coinm_futures', COINM_WALLET),
    { kind: 'isolated_margin', value_usd: 0, btc_valuation: 0, activate: false },
  ]
})()

export const equity = wallets.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)

export const income: IncomeBreakdown = {
  realized_pnl: 3847.22,
  funding_fee: -286.41,
  commission: -412.68,
  insurance_clear: 0,
  referral_kickback: 18.4,
  other: 0,
}

export const transfers: Transfers = {
  deposits_usd: 5000,
  withdrawals_usd: 2000,
  net_usd: 3000,
  deposit_count: 2,
  withdrawal_count: 1,
}

const OPENING_EQUITY = 74180.42

export function buildAttribution(windowDays: number): Attribution {
  const realized = income.realized_pnl + income.referral_kickback
  // 未实现变动由残差反解，瀑布图因此永远闭合，不会出现"各项加起来对不上期末"
  const unrealizedDelta = equity - OPENING_EQUITY - transfers.net_usd
    - realized - income.funding_fee - income.commission
  const truePnl = equity - OPENING_EQUITY - transfers.net_usd
  const averageCapital = OPENING_EQUITY + transfers.net_usd / 2
  return {
    window_days: windowDays,
    opening_equity: OPENING_EQUITY,
    closing_equity: equity,
    net_transfer: transfers.net_usd,
    realized_pnl: realized,
    unrealized_delta: unrealizedDelta,
    funding_fee: income.funding_fee,
    commission: income.commission,
    true_pnl: truePnl,
    true_return: averageCapital > 0 ? truePnl / averageCapital : null,
  }
}

/** 30 天日快照。真实来源 /sapi/v1/accountSnapshot，不需要后端自建表 */
export function buildEquityCurve(asOf: Date): EquityPoint[] {
  const points: EquityPoint[] = []
  const span = equity - OPENING_EQUITY
  for (let index = 0; index < 30; index += 1) {
    const day = new Date(asOf)
    day.setDate(day.getDate() - (29 - index))
    const wobble = Math.sin(index * 0.9) * 780 + Math.sin(index * 0.31 + 1.4) * 1420
    const value = OPENING_EQUITY + span * (index / 29) + (index === 29 ? 0 : wobble)
    points.push({ date: day.toISOString().slice(0, 10), equity_usd: value })
  }
  return points
}

export const okSource = (key: SourceState['key'], asOf: string): SourceState => ({
  key, status: 'ok', as_of: asOf, detail: null,
})

export function buildSnapshot(asOf: Date): PortfolioSnapshot {
  const iso = asOf.toISOString()
  const curve = buildEquityCurve(asOf)
  const yesterday = curve[curve.length - 2]?.equity_usd ?? null
  const notional = positions.reduce((sum, p) => sum + p.notional_usd, 0)
  return {
    as_of: iso,
    base_currency: 'USD',
    sources: ([
      'wallets', 'spot', 'futures', 'brackets', 'earn', 'margin', 'income', 'transfers', 'snapshots',
    ] as const).map((key) => okSource(key, iso)),
    totals: {
      equity_usd: equity,
      gross_exposure_ratio: equity > 0 ? notional / equity : null,
      change_24h_usd: yesterday === null ? null : equity - yesterday,
      change_24h_pct: yesterday ? (equity - yesterday) / yesterday : null,
    },
    wallets, spot, futures, earn, margin, income, transfers,
    equity_curve: curve,
    attribution: buildAttribution(30),
  }
}
