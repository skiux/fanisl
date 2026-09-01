import { PRICE } from './prices'
import { NVDA_ENTRY_PRICE, spotLockedByAsset } from './orders-fixtures'
import type {
  Attribution, EarnPosition, EquityPoint, FuturesAccount, FuturesPosition,
  IncomeBreakdown, MarginAccount, PortfolioSnapshot, SourceState, SpotAsset,
  Transfers, WalletBucket,
} from './types'

/** locked（挂单占用）不在这里写死，由委托 fixture 反推，两页的数对得上 */
type RawSpot = { asset: string; free: number; freeze?: number; withdrawing?: number }

/**
 * 现货账户。标的都在 U 本位永续上，现货这边只承担两件事：
 * USDT 作保证金与闲置资金，BNB 作手续费抵扣。剩下几笔是早年留下的小额，
 * 留着是因为真实账户里也一定有这种东西——灰尘折叠与"无报价"两条路径需要它们。
 */
const RAW_SPOT: RawSpot[] = [
  { asset: 'USDT', free: 12480.44, withdrawing: 500 },
  { asset: 'BNB', free: 4.212 },
  { asset: 'ETH', free: 0.0184 },
  { asset: 'SOL', free: 0.1043 },
  { asset: 'ARB', free: 26.4, freeze: 12 },
  { asset: 'DOGE', free: 21.86 },
  { asset: 'SHIB', free: 812400 },
  { asset: 'LUNC', free: 44210 },
  { asset: 'BETH', free: 0.0044 },
  { asset: 'PAXG', free: 0.00071 },
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

/**
 * U 本位永续持仓。标的是美股与金属——backend instruments.py 里这些标的的
 * exec_symbol 就是 Binance 永续（NVDA/USDT:USDT 等），分析走 Polygon/OANDA，
 * 下单盯市统一在这里。
 *
 * 保证金不再手写：起始保证金 = 名义 / 杠杆，维持保证金 = 名义 × 维持保证金率，
 * 两者都由档位推出来，改一个数不会让另外两个对不上。
 */
type RawPosition = {
  base: string
  symbol: string
  position_amt: number
  entry_price: number
  liquidation_price: number | null
  leverage: number
  isolated: boolean
  /** leverageBracket 给的维持保证金率 */
  mmr: number
  adl_quantile: number | null
}

const RAW_POSITIONS: RawPosition[] = [
  {
    // 开仓均价来自成交记录的加权平均，不在这里另写一遍
    base: 'NVDA', symbol: 'NVDAUSDT', position_amt: 38, entry_price: NVDA_ENTRY_PRICE,
    liquidation_price: 152.84, leverage: 3, isolated: false, mmr: 0.02, adl_quantile: 1,
  },
  {
    base: 'QQQ', symbol: 'QQQUSDT', position_amt: 14, entry_price: 604.13,
    liquidation_price: 448.57, leverage: 3, isolated: false, mmr: 0.015, adl_quantile: 1,
  },
  {
    base: 'XAU', symbol: 'XAUUSDT', position_amt: 1.8, entry_price: 4245.08,
    liquidation_price: 3486.21, leverage: 5, isolated: false, mmr: 0.01, adl_quantile: 2,
  },
  {
    // 空头：拿它对冲 AI/加密关联的 beta
    base: 'MSTR', symbol: 'MSTRUSDT', position_amt: -9, entry_price: 368.24,
    liquidation_price: 512.47, leverage: 2, isolated: true, mmr: 0.025, adl_quantile: 3,
  },
]

export const positions: FuturesPosition[] = RAW_POSITIONS.map((row) => {
  const mark = PRICE[row.base] as number
  const notional = Math.abs(row.position_amt) * mark
  const liq = row.liquidation_price
  return {
    symbol: row.symbol,
    position_side: 'both' as const,
    position_amt: row.position_amt,
    notional_usd: notional,
    entry_price: row.entry_price,
    mark_price: mark,
    liquidation_price: liq,
    liq_distance: liq === null ? null : Math.abs(mark - liq) / mark,
    leverage: row.leverage,
    isolated: row.isolated,
    unrealized_pnl_usd: (mark - row.entry_price) * row.position_amt,
    initial_margin_usd: notional / row.leverage,
    maint_margin_usd: notional * row.mmr,
    adl_quantile: row.adl_quantile,
  }
})

const FUTURES_WALLET = 9240.0

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

/** 理财这边放的是闲置保证金，不是投资仓位——所以只有 USDT 与手续费用的 BNB */
type RawEarn = {
  id: string
  asset: string
  amount: number
  kind: EarnPosition['kind']
  apr: number
  rewards: number
  redeem?: string
}

const RAW_EARN: RawEarn[] = [
  { id: 'USDT-FLEX', asset: 'USDT', amount: 8000, kind: 'flexible', apr: 0.0482, rewards: 164.21 },
  { id: 'USDT-30D', asset: 'USDT', amount: 5000, kind: 'locked', apr: 0.065, rewards: 62.38, redeem: '2026-09-14' },
  { id: 'BNB-FLEX', asset: 'BNB', amount: 1.5, kind: 'flexible', apr: 0.0035, rewards: 0.0092 },
]

export const earn: EarnPosition[] = RAW_EARN.map((row) => {
  const price = PRICE[row.asset]
  return {
    product_id: row.id,
    asset: row.asset,
    amount: row.amount,
    value_usd: price === null || price === undefined ? null : row.amount * price,
    kind: row.kind,
    apr: row.apr,
    cumulative_rewards: row.rewards,
    cumulative_rewards_usd: price === null || price === undefined ? null : row.rewards * price,
    redeem_date: row.redeem ?? null,
    can_redeem: row.kind === 'flexible',
  }
})

export const margin: MarginAccount = (() => {
  // marginLevel = 总资产 / 负债，不另写一个数
  const asset = 9412.55
  const liability = 5205.67
  return {
    margin_level: liability > 0 ? asset / liability : null,
    total_asset_usd: asset,
    total_liability_usd: liability,
    total_net_asset_usd: asset - liability,
  }
})()

const FUNDING_WALLET = 1842.3

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
    // 币本位与逐仓杠杆没开：接口会返回它们，但 activate=false，不该混进分布里
    { kind: 'coinm_futures', value_usd: 0, btc_valuation: 0, activate: false },
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

/**
 * 期初净值由"这段时间真赚了多少"倒推，而不是写死一个数——
 * 写死的话，持仓一改净值就变，30 天收益率立刻变成荒谬的数字。
 *
 * 真实盈亏 = 已实现 + 返佣 + 资金费 + 手续费 + 未实现变动，
 * 其中未实现变动就取当前持仓的浮盈浮亏（这批仓位都是窗口内开的）。
 * 这样归因表的残差项恰好等于 futures.total_unrealized_pnl，瀑布天然闭合。
 */
const TRUE_PNL_30D = income.realized_pnl + income.referral_kickback
  + income.funding_fee + income.commission + futures.total_unrealized_pnl

const OPENING_EQUITY = equity - transfers.net_usd - TRUE_PNL_30D

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
