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
  // 委托页
  | 'spot_open' | 'futures_open' | 'margin_open' | 'order_lists' | 'algo_open'
  | 'order_history' | 'trade_history'

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
  /** 累计收益的 USD 计价；前端没有价格表，换算由后端做 */
  cumulative_rewards_usd: number | null
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

/* ------------------------------------------------------------------ *
 * 委托。接口对照（2026-08 复核官方文档）：
 *   spot_open      GET /api/v3/openOrders        symbol 可省 → 全账户；weight 6 / 省略时 80
 *   order_lists    GET /api/v3/openOrderList     全部未完结的 OCO/OTO 组；weight 6
 *   futures_open   GET /fapi/v1/openOrders       symbol 可省 → 全账户；weight 1 / 省略时 40
 *   margin_open    GET /sapi/v1/margin/openOrders 全仓可省 symbol
 *   algo_open      GET /sapi/v1/algo/futures/openOrders  TWAP/VP 策略单
 *   order_history  GET /api/v3/allOrders   symbol 必填，区间 ≤ 24 小时
 *                  GET /fapi/v1/allOrders  symbol 必填，区间 < 7 天，回溯 90 天
 *   trade_history  GET /api/v3/myTrades    symbol 必填，区间 ≤ 24 小时
 *                  GET /fapi/v1/userTrades symbol 必填，区间 < 7 天，回溯 90 天
 *
 * 这一页的结构由上面这条分界线决定：**当前挂单能一次拿全账户，历史只能按
 * 交易对逐个问**。所以「挂单」是完整的，「历史」必须先选交易对，并且把窗口
 * 上限写在界面上，而不是假装能给出一条无限流水。
 * ------------------------------------------------------------------ */

export type OrderVenue = 'spot' | 'usdm' | 'margin'

export type OrderSide = 'buy' | 'sell'

/** origType，不是 type——条件单触发后 type 会变成 MARKET，origType 才是下单时的意图 */
export type OrderKind =
  | 'limit' | 'market' | 'limit_maker'
  | 'stop' | 'stop_market'
  | 'take_profit' | 'take_profit_market'
  | 'trailing_stop_market'

export type OrderStatus =
  | 'new' | 'partially_filled' | 'filled'
  | 'canceled' | 'expired' | 'rejected'

export type Order = {
  /** `${venue}:${orderId}`，跨账户拼一张表时才唯一 */
  id: string
  venue: OrderVenue
  symbol: string
  side: OrderSide
  kind: OrderKind
  status: OrderStatus
  /** 市价单没有委托价 */
  price: number | null
  /** 条件单的触发价 */
  stop_price: number | null
  /** workingType：按标记价还是最新成交价触发。现货没有这个概念 */
  trigger_by: 'mark' | 'last' | null
  /** 追踪止损的回调率 */
  callback_rate: number | null
  activate_price: number | null
  orig_qty: number
  executed_qty: number
  /** 委托名义价值（USD）。取不到报价时为 null，不用 0 顶替 */
  notional_usd: number | null
  time_in_force: 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTD' | null
  good_till_date: string | null
  reduce_only: boolean
  close_position: boolean
  position_side: PositionSide | null
  /** OCO/OTO 组 id；不属于任何组为 null */
  order_list_id: string | null
  /** 现价（现货用最新价，合约按 workingType 用标记价），用来算距触发/距成交多远 */
  reference_price: number | null
  created_at: string
  updated_at: string
}

/** OCO / OTO：一组里成交一条，另一条自动撤销。拆开看会以为挂了两倍的量 */
export type OrderList = {
  id: string
  venue: OrderVenue
  symbol: string
  contingency: 'OCO' | 'OTO' | 'OTOCO'
  status: 'executing' | 'all_done' | 'reject'
  /** 组内成员的 Order.id */
  order_ids: string[]
  created_at: string
}

export type Fill = {
  id: string
  order_id: string
  venue: OrderVenue
  symbol: string
  side: OrderSide
  price: number
  qty: number
  quote_qty: number
  commission: number
  commission_asset: string
  /** 挂单成交（返佣/低费率）还是吃单成交 */
  is_maker: boolean
  /** 仅合约有；现货成交不结算盈亏 */
  realized_pnl: number | null
  time: string
}

/** 历史只能按交易对查，所以查询条件本身是数据的一部分，要能显示出来 */
export type HistoryQuery = {
  symbol: string
  venue: OrderVenue
  /** 本次实际查询的区间 */
  from: string
  to: string
  /** 该 venue 单次允许的最大区间（小时），界面上要写明 */
  max_window_hours: number
  /** 该 venue 最多能回溯多少天；现货没有明确上限时为 null */
  lookback_days: number | null
}

export type OrdersSnapshot = {
  as_of: string | null
  sources: SourceState[]
  open: Order[]
  order_lists: OrderList[]
  /**
   * 可查历史的交易对。allOrders 必须传 symbol，后端只能从"有挂单 + 有持仓 +
   * 现货余额能配出的交易对"推一份候选，做不到真正的全量。
   */
  history_symbols: string[]
  query: HistoryQuery | null
  history: Order[]
  fills: Fill[]
}
