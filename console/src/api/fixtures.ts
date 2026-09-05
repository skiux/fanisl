import { PRICE } from './prices'
import { NVDA_ENTRY_PRICE, spotLockedByAsset } from './orders-fixtures'
import type {
  EarnPosition, FuturesAccount, FuturesPosition, Pnl,
  IncomeBreakdown, MarginAccount, PortfolioSnapshot, SourceState, SpotAsset,
  SpotCostRow, Transfers, WalletBucket,
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
 * 归因表走后端同一套口径。两条要点：
 *
 * - **期末只算日快照覆盖的三个钱包**（现货 / 全仓杠杆 / U 本位合约）。理财、资金
 *   这些钱包在总净值里，但 accountSnapshot 没有它们，混进来就等于把理财本金
 *   算成这段时间的利润。
 * - **期初是一个写下来的数，不是倒推的**。它对应 accountSnapshot 那天的余额，
 *   属于接口给的原始值；倒推的话，归因表就成了自己证明自己，任何口径错误
 *   都会被残差项吸走而看不出来——线上那个 bug 正是这么藏了很久。
 */





export const okSource = (key: SourceState['key'], asOf: string): SourceState => ({
  key, status: 'ok', as_of: asOf, detail: null,
})

/**
 * 盈亏构成。和后端同一套口径：现货按成交重放的加权平均成本，合约取交易所给的
 * 未实现与已实现。**没有残差项**——旧的归因表用"期末 − 期初 − 净充提"，
 * 钱包间划转会被算成盈亏。
 */
function buildPnl(): Pnl {
  const spotRows = spot
    .filter((row) => row.value_usd !== null && row.total > 0)
    .map((row) => {
      const cash = STABLE_FIXTURE.includes(row.asset)
      // 均价编在成本上，不编在盈亏上：盈亏由市值减成本算出来
      const avg = cash ? 1 : (SPOT_AVG_COST[row.asset] ?? null)
      const value = row.value_usd as number
      // 划转 / 理财进来的那部分：样例里给 BNB 留一截没有买入记录的量，
      // 好让"成本不明"那条路径在本地也走得到
      const unpriced = row.asset === 'BNB' ? row.total * 0.4 : 0
      return {
        asset: row.asset, qty: row.total, unpriced_qty: unpriced, avg_cost_usd: avg,
        cost_source: (cash ? 'cash' : avg === null ? null : 'trades') as SpotCostRow['cost_source'],
        price_usd: row.price_usd, value_usd: value,
        unrealized_usd: avg === null ? null : (row.total - unpriced) * ((row.price_usd ?? 0) - avg),
        realized_usd: cash ? 0 : (SPOT_REALIZED[row.asset] ?? 0),
        cost_known: avg !== null, is_cash: cash,
      }
    })
  const spotUnreal = spotRows.reduce((sum, r) => sum + (r.unrealized_usd ?? 0), 0)
  const spotReal = spotRows.reduce((sum, r) => sum + (r.realized_usd ?? 0), 0)
  return {
    unrealized: {
      spot_usd: spotUnreal,
      futures_usd: futures.total_unrealized_pnl,
      total_usd: spotUnreal + futures.total_unrealized_pnl,
      scope: '此刻的持仓',
    },
    realized: {
      spot_usd: spotReal,
      spot_scope: '全部成交历史',
      futures_usd: income.realized_pnl,
      futures_scope: '最近 90 天（接口上限）',
    },
    carry: {
      funding_usd: income.funding_fee,
      commission_usd: income.commission,
      referral_usd: income.referral_kickback,
      scope: '最近 90 天',
    },
    daily: buildDaily(),
    today_usd: buildDaily().at(-1)?.realized_usd ?? null,
    spot_assets: spotRows,
    coverage: '只覆盖当前还持有的币；已清仓的标的查不到交易对',
    incomplete_assets: spotRows.filter((r) => !r.cost_known).map((r) => r.asset),
    failed_symbols: [],
  }
}

/**
 * 每天落袋多少。日频离散数据，样例里用一个稳定的伪随机——刷新页面不该换一批数，
 * 否则没法拿它对界面。真实来源是合约 income 逐行分桶 + 现货成交结转。
 */
function buildDaily() {
  const out = []
  const today = new Date()
  for (let back = 89; back >= 0; back -= 1) {
    const day = new Date(today)
    day.setDate(day.getDate() - back)
    const weekday = day.getDay()
    // 周末不交易：日历上留白比编一个假数字诚实
    const traded = weekday !== 0 && weekday !== 6 && Math.sin(back * 2.7) > -0.45
    const swing = Math.sin(back * 1.31) * 420 + Math.sin(back * 0.47 + 2) * 260
    out.push({
      date: day.toISOString().slice(0, 10),
      realized_usd: traded ? Math.round(swing * 100) / 100 : 0,
      traded,
    })
  }
  return out
}

const STABLE_FIXTURE = ['USDT', 'USDC', 'BUSD', 'FDUSD']

/** 现货持仓的加权平均成本。这是"接口重放出来的"，属于原始输入，写死合理 */
const SPOT_AVG_COST: Record<string, number> = {
  BNB: 612.4, ETH: 2980.5, SOL: 205.1, ARB: 1.04, DOGE: 0.288,
  SHIB: 0.00002114, LUNC: 0.00000118,
}

/** 已清掉的那部分实现了多少 */
const SPOT_REALIZED: Record<string, number> = { BNB: 184.2, ETH: -62.4, SOL: 41.8 }

export function buildSnapshot(asOf: Date): PortfolioSnapshot {
  const iso = asOf.toISOString()
  const notional = positions.reduce((sum, p) => sum + p.notional_usd, 0)
  return {
    as_of: iso,
    base_currency: 'USD',
    sources: ([
      'wallets', 'spot', 'futures', 'earn', 'margin', 'income', 'transfers',
    ] as const).map((key) => okSource(key, iso)),
    totals: {
      equity_usd: equity,
      gross_exposure_ratio: equity > 0 ? notional / equity : null,
    },
    wallets, spot, futures, earn, margin, income, transfers,
    pnl: buildPnl(),
  }
}
