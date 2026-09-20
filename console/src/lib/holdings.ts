import { baseOf } from './format'
import type { PortfolioSnapshot, SpotAsset } from '../api/types'

/**
 * 跨钱包地看"我到底拿着什么"。
 *
 * 页面上原先没有这一层：现货、理财、合约仓位和各钱包余额各画各的，
 * 于是**"我对 NVDA 一共有多大敞口"这个问题在哪一页都答不上来**——现货那份在一张表里，
 * 永续那份在另一张表里，两者相加没人做。风险判断要的恰恰是相加之后的数。
 *
 * 两件事在这里一次算清，别处只消费结果：
 *   `exposures`  按标的合并的净敞口（现货类 + 带方向的永续名义）
 *   `cash`       稳定币在各个钱包里各有多少
 *
 * "哪些算现金"由后端给（`snapshot.stable_assets`），前端不再自己维护名单。
 */
export type Exposure = {
  asset: string
  /** 现货类持有：现货钱包 + 理财 + 全仓杠杆 + 合约钱包里躺着的币 */
  spot_usd: number
  /** 永续名义，**带方向**：多头为正、空头为负 */
  perp_usd: number
  /** 两者之和。空头会抵掉现货——价格动的时候，账户感受到的是这个数 */
  net_usd: number
  /** 名义敞口（不抵消）：多空对锁时它不为零，而 `net_usd` 为零 */
  gross_usd: number
  /** `|net_usd|` 占净值 */
  share: number
}

export function exposures(snapshot: PortfolioSnapshot, equity: number): Exposure[] {
  const stable = new Set(snapshot.stable_assets)
  // 股票按股票代码合并（AAPLB → AAPL、EQ_SOXL → SOXL）。它们若同时出现在现货行里，
  // 那一行要跳过，否则同一笔钱算两次
  const stockCodes = new Set([...snapshot.stocks.tokenized_assets, ...snapshot.stocks.equity_holdings]
    .map((row) => row.asset_code))
  const byAsset = new Map<string, { spot: number; perp: number; gross: number }>()
  const add = (asset: string, spot: number, perp: number) => {
    if (!asset || stable.has(asset)) return
    const hit = byAsset.get(asset) ?? { spot: 0, perp: 0, gross: 0 }
    hit.spot += spot
    hit.perp += perp
    hit.gross += Math.abs(spot) + Math.abs(perp)
    byAsset.set(asset, hit)
  }

  for (const row of snapshot.spot) {
    if (!stockCodes.has(row.asset)) add(row.asset, row.value_usd ?? 0, 0)
  }
  for (const row of snapshot.stocks.tokenized_assets) add(row.symbol, row.value_usd ?? 0, 0)
  for (const row of snapshot.stocks.equity_holdings) add(row.symbol, row.value_usd ?? 0, 0)
  for (const row of snapshot.earn) add(row.asset, row.value_usd ?? 0, 0)
  for (const row of snapshot.margin?.assets ?? []) add(row.asset, row.value_usd ?? 0, 0)
  for (const row of snapshot.futures?.assets ?? []) add(row.asset, row.value_usd ?? 0, 0)
  for (const position of snapshot.futures?.positions ?? []) {
    // 名义带方向：空头抵掉同一标的的现货，这才是价格动一下账户真实的暴露
    add(baseOf(position.symbol), 0,
        position.position_amt >= 0 ? position.notional_usd : -position.notional_usd)
  }

  return [...byAsset.entries()]
    .map(([asset, v]) => ({
      asset,
      spot_usd: v.spot,
      perp_usd: v.perp,
      net_usd: v.spot + v.perp,
      gross_usd: v.gross,
      share: equity > 0 ? Math.abs(v.spot + v.perp) / equity : 0,
    }))
    .filter((row) => row.gross_usd > 0)
    .sort((a, b) => Math.abs(b.net_usd) - Math.abs(a.net_usd) || b.gross_usd - a.gross_usd)
}

export type SpotHoldingRow = SpotAsset & {
  /** 同一种币可能分散在多个钱包；主表合并数量，但保留位置提示。 */
  locations: string[]
}

export function spotHoldings(snapshot: PortfolioSnapshot): SpotHoldingRow[] {
  type Pending = SpotHoldingRow & { known_value: number; value_complete: boolean }
  const stable = new Set(snapshot.stable_assets)
  const byAsset = new Map<string, Pending>()
  const add = (asset: string, quantity: number, value: number | null, location: string,
               locks: Pick<SpotAsset, 'free' | 'locked' | 'freeze' | 'withdrawing'>) => {
    if (!asset || quantity <= 0) return
    const row = byAsset.get(asset) ?? {
      asset, free: 0, locked: 0, freeze: 0, withdrawing: 0, total: 0,
      price_usd: null, value_usd: null, locations: [], known_value: 0,
      value_complete: true,
    }
    row.free += locks.free
    row.locked += locks.locked
    row.freeze += locks.freeze
    row.withdrawing += locks.withdrawing
    row.total += quantity
    if (value === null) row.value_complete = false
    else row.known_value += value
    if (!row.locations.includes(location)) row.locations.push(location)
    byAsset.set(asset, row)
  }

  for (const row of snapshot.spot) {
    if (!stable.has(row.asset)) add(row.asset, row.total, row.value_usd, '现货', row)
  }
  for (const row of snapshot.futures?.assets ?? []) {
    if (!stable.has(row.asset)) {
      add(row.asset, row.wallet_balance, row.value_usd, '合约钱包', {
        free: row.wallet_balance, locked: 0, freeze: 0, withdrawing: 0,
      })
    }
  }
  for (const row of snapshot.margin?.assets ?? []) {
    if (!stable.has(row.asset)) {
      add(row.asset, row.net, row.value_usd, '全仓杠杆', {
        free: row.net, locked: 0, freeze: 0, withdrawing: 0,
      })
    }
  }

  return [...byAsset.values()].map(({ known_value, value_complete, ...row }) => ({
    ...row,
    value_usd: value_complete ? known_value : null,
    price_usd: value_complete && row.total > 0 ? known_value / row.total : null,
  })).sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1))
}

/** 现金放在哪儿。同一个币可能同时在几个地方，所以数的是**行**不是币种 */
export type CashRow = {
  asset: string
  where: string
  amount: number
  value_usd: number | null
  /** 理财产品年化，或 BFUSD 等资产的官方公布年化。 */
  apr: number | null
}

export function cash(snapshot: PortfolioSnapshot): CashRow[] {
  const stable = new Set(snapshot.stable_assets)
  const rows: CashRow[] = []
  const push = (asset: string, where: string, amount: number,
                value: number | null, apr: number | null = null) => {
    if (!stable.has(asset) || amount <= 0) return
    rows.push({ asset, where, amount, value_usd: value, apr })
  }

  const published = (asset: string) => snapshot.yield_rates[asset] ?? null
  for (const row of snapshot.spot) {
    push(row.asset, '现货', row.total, row.value_usd, published(row.asset))
  }
  for (const row of snapshot.earn) {
    push(row.asset, row.kind === 'locked' ? '理财 · 定期' : '理财 · 活期',
         row.amount, row.value_usd, row.apr ?? published(row.asset))
  }
  for (const row of snapshot.margin?.assets ?? []) {
    push(row.asset, '全仓杠杆', row.net, row.value_usd, published(row.asset))
  }
  // 合约钱包里的稳定币就是**保证金本身**，是这几行里唯一直接决定强平的
  for (const row of snapshot.futures?.assets ?? []) {
    push(row.asset, '合约保证金', row.wallet_balance, row.value_usd, published(row.asset))
  }
  return rows.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
}
