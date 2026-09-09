import { baseOf } from './format'
import type { PortfolioSnapshot } from '../api/types'

/**
 * 跨钱包地看"我到底拿着什么"。
 *
 * 页面上原先没有这一层：现货持仓、理财持仓、合约仓位、合约中的现货持仓各画各的，
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
  const byAsset = new Map<string, { spot: number; perp: number; gross: number }>()
  const add = (asset: string, spot: number, perp: number) => {
    if (!asset || stable.has(asset)) return
    const hit = byAsset.get(asset) ?? { spot: 0, perp: 0, gross: 0 }
    hit.spot += spot
    hit.perp += perp
    hit.gross += Math.abs(spot) + Math.abs(perp)
    byAsset.set(asset, hit)
  }

  for (const row of snapshot.spot) add(row.asset, row.value_usd ?? 0, 0)
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

/** 现金放在哪儿。同一个币可能同时在几个地方，所以数的是**行**不是币种 */
export type CashRow = {
  asset: string
  where: string
  amount: number
  value_usd: number | null
  /** 只有理财那几行有年化 */
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

  for (const row of snapshot.spot) push(row.asset, '现货', row.total, row.value_usd)
  for (const row of snapshot.earn) {
    push(row.asset, row.kind === 'locked' ? '理财 · 定期' : '理财 · 活期',
         row.amount, row.value_usd, row.apr)
  }
  for (const row of snapshot.margin?.assets ?? []) push(row.asset, '全仓杠杆', row.net, row.value_usd)
  // 合约钱包里的稳定币就是**保证金本身**，是这几行里唯一直接决定强平的
  for (const row of snapshot.futures?.assets ?? []) {
    push(row.asset, '合约保证金', row.wallet_balance, row.value_usd)
  }
  return rows.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
}
