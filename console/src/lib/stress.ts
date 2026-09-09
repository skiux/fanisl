import type { PortfolioSnapshot } from '../api/types'

/**
 * 压力测试：**所有标的一起跌 d，账户会怎样。**
 *
 * 这一页要回答的不是"我现在赚了多少"，而是"再跌多少我就出局"。合约页上有逐个仓位的
 * 「距强平」，但那是每个仓位各自的距离；账户是共用一份保证金的，**多个仓位一起亏
 * 才是真实情形**，逐个看会systematically低估风险。
 *
 * 口径与简化（都写在这里，不进界面）：
 *
 * - 标记价一律 `mark × (1 − d)`。空头在下跌里是赚的，同一个公式自然带出来。
 * - 未实现从**开仓价重算**（`(新标记 − 开仓) × 数量`），不拿接口给的总额去加减：
 *   两者口径若差一点，减出来的 Δ 会把误差放大。
 * - 维持保证金与起始保证金**随名义等比缩放**：它们都是 名义 × 比率，同一个 d 下
 *   就是乘 `(1 − d)`。这里忽略了 leverageBracket 的档位跳变——名义变小只会往
 *   更低的档走、比率只会更松，所以这个估计是**偏保守的**，不会把危险说轻。
 * - 保证金余额按 USDT 计价，不随行情变。联合保证金（用 BTC/BNB 当保证金）下这
 *   会低估亏损，那种账户 `futures.assets` 里会有非稳定币，界面上看得到。
 */
export type Shock = {
  drop: number
  /** 冲击之后的净值 */
  equity_usd: number | null
  unrealized_usd: number | null
  margin_balance: number | null
  /** 维持保证金 / 保证金余额，到 1 就是强平线 */
  margin_ratio: number | null
  available_usd: number | null
  /**
   * 这一跌会被强平的**逐仓**仓位。
   *
   * 全仓的不在这里：交易所给的 `liquidationPrice` 是"别的都不动、只有这个仓位
   * 的价格变"算出来的，而这里恰恰是所有标的一起跌——那个价在这种情形下不成立。
   * 全仓共用一份保证金，判据是账户的 `margin_ratio` 到 1，`breakingDrop` 就是解它。
   * 两套判据混着报会自相矛盾：屏幕上出现过"保证金率 8.6% 安全"底下挂着
   * 两行"触及强平价"。
   */
  liquidated: string[]
}

type Leg = {
  symbol: string; amt: number; mark: number; entry: number
  maint: number; initial: number; liq: number | null; isolated: boolean
}

function legs(snapshot: PortfolioSnapshot): Leg[] {
  return (snapshot.futures?.positions ?? []).map((p) => ({
    symbol: p.symbol,
    amt: p.position_amt,
    mark: p.mark_price,
    entry: p.entry_price,
    maint: p.maint_margin_usd,
    initial: p.initial_margin_usd,
    liq: p.liquidation_price,
    isolated: p.isolated,
  }))
}

/** 会跟着行情一起跌的现货类持有（稳定币不动，所以不算） */
function riskAssets(snapshot: PortfolioSnapshot): number {
  const stable = new Set(snapshot.stable_assets)
  const sum = (rows: { asset: string; value_usd: number | null }[]) =>
    rows.filter((r) => !stable.has(r.asset)).reduce((acc, r) => acc + (r.value_usd ?? 0), 0)
  return sum(snapshot.spot) + sum(snapshot.earn)
    + sum(snapshot.margin?.assets ?? []) + sum(snapshot.futures?.assets ?? [])
}

export function shock(snapshot: PortfolioSnapshot, drop: number): Shock {
  const f = snapshot.futures
  const rows = legs(snapshot)
  const k = 1 - drop

  const base = rows.reduce((sum, p) => sum + (p.mark - p.entry) * p.amt, 0)
  const after = rows.reduce((sum, p) => sum + (p.mark * k - p.entry) * p.amt, 0)
  const maint = rows.reduce((sum, p) => sum + p.maint, 0) * k
  const initial = rows.reduce((sum, p) => sum + p.initial, 0) * k

  const wallet = f?.total_wallet_balance ?? null
  const balance = wallet === null ? null : wallet + after
  const equity = snapshot.totals?.equity_usd ?? null

  return {
    drop,
    equity_usd: equity === null ? null : equity - drop * riskAssets(snapshot) + (after - base),
    unrealized_usd: f === null ? null : after,
    margin_balance: balance,
    margin_ratio: balance === null ? null : balance <= 0 ? 1 : maint / balance,
    available_usd: balance === null ? null : balance - initial,
    liquidated: rows
      .filter((p) => p.isolated && p.liq !== null
        && (p.amt >= 0 ? p.mark * k <= p.liq : p.mark * k >= p.liq))
      .map((p) => p.symbol),
  }
}

/**
 * **一起跌多少开始强平。** 二分找最小的 d 使保证金率到 1。
 *
 * 解析解也能写（对 d 是线性的），但符号很容易翻错：净空头的账户里分母会变号，
 * 一个漏掉的绝对值就把"永远不会强平"算成"跌 3% 就爆"。数值搜索没有这个风险，
 * 四十次迭代的代价可以忽略。
 *
 * `extraMargin` 是"再补多少保证金进去"，用来回答"把现金划进合约能多扛多少"。
 * 净空头 / 没有仓位时返回 null——那不是"很安全"，是这个问题不成立。
 */
export function breakingDrop(snapshot: PortfolioSnapshot, extraMargin = 0): number | null {
  if ((snapshot.futures?.positions.length ?? 0) === 0) return null
  const padded: PortfolioSnapshot = extraMargin === 0 ? snapshot : {
    ...snapshot,
    futures: snapshot.futures && {
      ...snapshot.futures,
      total_wallet_balance: snapshot.futures.total_wallet_balance + extraMargin,
    },
  }
  const blown = (d: number) => {
    const hit = shock(padded, d)
    return hit.margin_ratio !== null && hit.margin_ratio >= 1
  }
  if (!blown(0.995)) return null
  if (blown(0)) return 0
  let lo = 0
  let hi = 0.995
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (blown(mid)) hi = mid
    else lo = mid
  }
  return hi
}
