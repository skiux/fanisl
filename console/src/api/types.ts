/**
 * 资产接口契约 v2。字段按 Binance 实际接口对齐，不再按"想当然的余额模型"编。
 * 后端落地后应由 openapi-typescript 从 /openapi.json 生成的类型替换本文件。
 *
 * 数据来源对照：
 *   wallets    GET  /sapi/v1/asset/wallet/balance          六个钱包的分布
 *   spot       POST /sapi/v3/asset/getUserAsset            现货逐币（四种锁定态）
 *   futures    GET  /fapi/v2/account + /fapi/v1/accountConfig
 *   brackets   GET  /fapi/v1/leverageBracket               维持保证金档位→真实强平边际
 *   earn       GET  /sapi/v1/simple-earn/{flexible,locked}/position
 *   margin     GET  /sapi/v1/margin/account                marginLevel
 *   income     GET  /fapi/v1/income                        资金费/已实现/手续费
 *   transfers  GET  /sapi/v1/capital/{deposit/hisrec,withdraw/history}
 *   snapshots  GET  /sapi/v1/accountSnapshot               最多 30 天日快照
 */

/** 能独立失败的来源分组。451 打在 fapi 上会同时带走 futures 与 income，但不影响 spot。 */
export type SourceKey =
  | 'wallets' | 'spot' | 'futures' | 'brackets'
  | 'earn' | 'margin' | 'income' | 'transfers' | 'snapshots'

export type SourceStatus = 'ok' | 'unreachable' | 'unauthorized' | 'rate_limited' | 'unsupported'

export type SourceState = {
  key: SourceKey
  status: SourceStatus
  /** 最后一次成功取数时刻；从未成功为 null */
  as_of: string | null
  detail: string | null
}

/** GET /sapi/v1/asset/wallet/balance 的 walletName 取值 */
export type WalletKind =
  | 'spot' | 'funding' | 'cross_margin' | 'isolated_margin'
  | 'usdm_futures' | 'coinm_futures' | 'earn'

export type WalletBucket = {
  kind: WalletKind
  /** 该钱包合计（USD 计价；接口原生是 BTC 计价，后端负责换算并保留 btc 原值） */
  value_usd: number | null
  btc_valuation: number | null
  activate: boolean
}

/** getUserAsset：锁定原因不止一种，合并成 used 会丢掉"为什么动不了" */
export type SpotAsset = {
  asset: string
  free: number
  /** 挂单占用 */
  locked: number
  /** 风控/审核冻结 */
  freeze: number
  /** 提现处理中 */
  withdrawing: number
  total: number
  price_usd: number | null
  value_usd: number | null
}

export type PositionSide = 'long' | 'short' | 'both'

export type FuturesPosition = {
  symbol: string
  /** 双向持仓模式下同一 symbol 会有 LONG 与 SHORT 两条 */
  position_side: PositionSide
  position_amt: number
  notional_usd: number
  entry_price: number
  mark_price: number
  liquidation_price: number | null
  /** 标记价到强平价的距离占比，由 leverageBracket 的维持保证金率推得 */
  liq_distance: number | null
  leverage: number
  isolated: boolean
  unrealized_pnl_usd: number
  initial_margin_usd: number
  maint_margin_usd: number
  /** 自动减仓排队分位 0–4，越高越先被减仓；取不到为 null */
  adl_quantile: number | null
}

export type FuturesAccount = {
  /** 单向 / 双向持仓 */
  dual_side_position: boolean
  multi_assets_margin: boolean
  total_wallet_balance: number
  total_margin_balance: number
  total_unrealized_pnl: number
  total_initial_margin: number
  total_maint_margin: number
  available_balance: number
  max_withdraw: number
  /** totalMaintMargin / totalMarginBalance，越接近 1 越危险 */
  margin_ratio: number | null
  positions: FuturesPosition[]
}

export type EarnPosition = {
  product_id: string
  asset: string
  amount: number
  value_usd: number | null
  kind: 'flexible' | 'locked'
  /** 最新年化，locked 为固定年化 */
  apr: number | null
  cumulative_rewards: number | null
  /** locked 才有 */
  redeem_date: string | null
  can_redeem: boolean
}

export type MarginAccount = {
  /** < 1.3 触发强平预警，< 1.1 强平 */
  margin_level: number | null
  total_asset_usd: number
  total_liability_usd: number
  total_net_asset_usd: number
}

/** /fapi/v1/income 按类型汇总。资金费是永续的持续性损益，长期持仓可能超过价格波动本身。 */
export type IncomeBreakdown = {
  realized_pnl: number
  funding_fee: number
  commission: number
  insurance_clear: number
  referral_kickback: number
  other: number
}

export type Transfers = {
  deposits_usd: number
  withdrawals_usd: number
  /** 净充提。真实收益 = 期末 − 期初 − 净充提 */
  net_usd: number
  deposit_count: number
  withdrawal_count: number
}

export type EquityPoint = {
  /** YYYY-MM-DD */
  date: string
  equity_usd: number
}

/**
 * 期间业绩归因。净值涨了不等于赚了——可能只是充钱进去。
 * 恒等式：closing = opening + net_transfer + realized + unrealized_delta + funding + commission
 * unrealized_delta 由残差反解，保证瀑布图永远闭合。
 */
export type Attribution = {
  window_days: number
  opening_equity: number
  closing_equity: number
  net_transfer: number
  realized_pnl: number
  unrealized_delta: number
  funding_fee: number
  commission: number
  /** 剔除充提后的真实盈亏 */
  true_pnl: number
  /** true_pnl / 平均投入资本 */
  true_return: number | null
}

export type PortfolioTotals = {
  equity_usd: number
  /** 合约名义敞口 / 净值。衡量真实杠杆，比单笔的 leverage 有意义 */
  gross_exposure_ratio: number | null
  change_24h_usd: number | null
  change_24h_pct: number | null
}

export type PortfolioSnapshot = {
  as_of: string | null
  base_currency: 'USD'
  sources: SourceState[]
  totals: PortfolioTotals | null
  wallets: WalletBucket[]
  spot: SpotAsset[]
  futures: FuturesAccount | null
  earn: EarnPosition[]
  margin: MarginAccount | null
  income: IncomeBreakdown | null
  transfers: Transfers | null
  equity_curve: EquityPoint[]
  attribution: Attribution | null
}

export class PortfolioError extends Error {
  readonly kind: 'network' | 'server'
  constructor(kind: 'network' | 'server', message: string) {
    super(message)
    this.name = 'PortfolioError'
    this.kind = kind
  }
}
