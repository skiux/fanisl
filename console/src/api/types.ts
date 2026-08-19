/**
 * 资产接口契约。目前由 mock 实现，后端落地后这份手写类型应当被
 * `openapi-typescript` 从 /openapi.json 生成的类型替换——编译器会把
 * 每一处对不上的字段指出来。在那之前，这里就是前后端唯一的锚点。
 */

export type Venue = 'spot' | 'futures'

/** 单个来源的可达性。现货成功、合约被拦是常态，必须分开表达。 */
export type VenueStatus =
  | 'ok'
  | 'unreachable'    // 网络/地区限制（451、超时）
  | 'unauthorized'   // key 失效、权限不足、IP 不在白名单
  | 'rate_limited'

export type VenueState = {
  venue: Venue
  status: VenueStatus
  /** 该来源最后一次成功取数的时刻；从未成功则为 null */
  as_of: string | null
  /** 面向人的解释，不是异常堆栈 */
  detail: string | null
}

export type Balance = {
  asset: string
  venue: Venue
  free: number
  used: number
  total: number
  /** 无法定价（新币种、已下架、无 USDT 交易对）时为 null，不要填 0 */
  price_usd: number | null
  value_usd: number | null
}

export type Position = {
  symbol: string
  side: 'long' | 'short'
  contracts: number
  notional_usd: number
  entry_price: number
  mark_price: number
  liquidation_price: number | null
  leverage: number
  margin_mode: 'cross' | 'isolated'
  unrealized_pnl_usd: number
  initial_margin_usd: number
}

export type FuturesRisk = {
  /** 维持保证金 / 保证金余额，0..1，越高越接近强平 */
  margin_ratio: number | null
  maintenance_margin_usd: number
  margin_balance_usd: number
}

export type PortfolioTotals = {
  /** 已取到部分的合计。有来源不可达时这是"部分净值"，由 venues 说明缺了谁 */
  equity_usd: number
  /** 对应来源取不到时为 null——不要用 0 表示"没数据"，0 是一个有效余额 */
  spot_usd: number | null
  futures_usd: number | null
  unrealized_pnl_usd: number | null
  /** 没有昨日快照时为 null——不要用 0 冒充"持平" */
  change_24h_usd: number | null
  change_24h_pct: number | null
}

export type PortfolioSnapshot = {
  /** 整份快照的取数时刻（各来源里最旧的那个） */
  as_of: string | null
  base_currency: 'USD'
  venues: VenueState[]
  totals: PortfolioTotals | null
  balances: Balance[]
  positions: Position[]
  futures_risk: FuturesRisk | null
}

/** 后端整体不可达时前端拿到的形态 */
export class PortfolioError extends Error {
  readonly kind: 'network' | 'server'
  constructor(kind: 'network' | 'server', message: string) {
    super(message)
    this.name = 'PortfolioError'
    this.kind = kind
  }
}
