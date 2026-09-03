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
 */

/** 能独立失败的来源分组。451 打在 fapi 上会同时带走 futures 与 income，但不影响 spot。 */
export type SourceKey =
  // 行情是**公开端点**，不需要凭据。它单独成一个来源：没配 key 时它照常正常，
  // 而其余全部 unauthorized——界面据此能分清"网络/凭据问题"与"确实没有资产"。
  | 'prices'
  | 'wallets' | 'spot' | 'futures'
  | 'earn' | 'margin' | 'income' | 'transfers'
  // 委托页
  | 'spot_open' | 'futures_open' | 'margin_open' | 'order_lists' | 'algo_open'
  | 'order_history' | 'trade_history'
  // 流水页
  | 'deposits' | 'withdrawals' | 'wallet_transfers' | 'earn_rewards'
  | 'margin_interest' | 'convert' | 'dust'

export type SourceStatus = 'ok' | 'unreachable' | 'unauthorized' | 'rate_limited' | 'unsupported'

export type SourceState = {
  key: SourceKey
  status: SourceStatus
  /** 最后一次成功取数时刻；从未成功为 null */
  as_of: string | null
  detail: string | null
}

/** GET /sapi/v1/asset/wallet/balance 的 walletName 取值 */
/**
 * `walletName` 的取值。未登记的名字后端会 slug 化后原样返回（而不是丢弃——
 * 丢掉就等于把那部分钱从净值里抹掉），所以这里留一个 string 兜底。
 */
export type WalletKind =
  | 'spot' | 'funding' | 'cross_margin' | 'isolated_margin'
  | 'usdm_futures' | 'coinm_futures' | 'earn'
  | 'options' | 'trading_bots'
  | (string & {})

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
  /** 实际天数，不是固定 30——日快照只留 30 天，账户不满或缺日都会短一截 */
  window_days: number
  /** 窗口第一天（曲线起点），YYYY-MM-DD */
  window_start: string
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

export type DailyRealized = {
  /** YYYY-MM-DD，UTC 日切，与 Binance 的结算日一致 */
  date: string
  realized_usd: number
  /** 这天有没有成交/结算。没有的话 realized_usd 是 0，不是"亏了 0" */
  traded: boolean
}

export type SpotCostRow = {
  asset: string
  qty: number
  /** 这些币没见过买入记录（划转 / 理财 / 小额兑换进来的），成本算不出来，不计入盈亏 */
  unpriced_qty: number
  avg_cost_usd: number | null
  price_usd: number | null
  value_usd: number | null
  unrealized_usd: number | null
  realized_usd: number | null
  cost_known: boolean
  is_cash: boolean
}

/**
 * 盈亏构成。**每一项都有出处，没有残差项**（旧的 Attribution 是"期末 − 期初 −
 * 净充提"，剩下的靠残差反解，钱包间划转会被算成盈亏）。
 *
 * 三块的窗口不一样，是接口的硬限：现货成交没有时间上限，合约损益只保留 90 天，
 * 合约未实现是此刻的值。所以不能加成一个数说"这段时间赚了多少"。
 */
export type Pnl = {
  unrealized: {
    spot_usd: number | null
    futures_usd: number | null
    total_usd: number | null
    scope: string
  }
  realized: {
    spot_usd: number | null
    spot_scope: string
    futures_usd: number | null
    futures_scope: string
  }
  carry: {
    funding_usd: number | null
    commission_usd: number | null
    referral_usd: number | null
    scope: string
  }
  /** 每天落袋多少。取代净值走势图——那条线来自日快照，钱包间划转会让它骗人 */
  daily: DailyRealized[]
  today_usd: number | null
  spot_assets: SpotCostRow[]
  /** 覆盖范围的实话：已清仓的标的查不到交易对 */
  coverage: string | null
  incomplete_assets: string[]
  failed_symbols: string[]
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
  pnl: Pnl | null
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
  // 策略单（/sapi/v1/algo/futures/openOrders）。多数账户是空的，
  // 但"空"与"没查"是两回事，不查就等于悄悄漏掉一类挂单。
  | 'twap' | 'vp'

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

/* ------------------------------------------------------------------ *
 * 流水。这一页最要紧的事实：**Binance 没有统一的流水接口**。
 * 下面这条时间线是八个端点各拉一段合并出来的，每条记录都得带着自己的出处。
 * 接口对照（2026-08 复核官方文档）：
 *
 *   deposits          GET /sapi/v1/capital/deposit/hisrec          w1      区间 ≤ 90 天
 *   withdrawals       GET /sapi/v1/capital/withdraw/history        w18000  区间 ≤ 90 天，10 次/秒
 *   income            GET /fapi/v1/income                          w30     只存 3 个月，默认只给 7 天
 *   wallet_transfers  GET /sapi/v1/asset/transfer                  w1      回溯 6 个月，**type 必填**
 *   earn_rewards      GET /sapi/v1/simple-earn/flexible/history/…  w150    区间 ≤ 30 天
 *   margin_interest   GET /sapi/v1/margin/interestHistory          w1      区间 ≤ 30 天，回溯 90 天
 *   convert           GET /sapi/v1/convert/tradeFlow               w3000   区间 ≤ 30 天，起止必填
 *   dust              GET /sapi/v1/asset/dribblet                  w1      —
 *
 * 由此得到两条决定页面形状的结论：
 *   ① 整条时间线真正可信的窗口 = 各来源上限的交集 = 30 天（被理财派息 / 杠杆利息 /
 *      闪兑卡住），不是想翻多久就翻多久；
 *   ② 钱包划转必须按 type 逐个问（约 40 种），一次"全量刷新"是几十次调用，
 *      提现那一个的 weight 还是 18000。刷新在这一页不是免费的，界面要说出来。
 * ------------------------------------------------------------------ */

export type LedgerKind =
  // 外部进出：改变本金，但不是盈亏
  | 'deposit' | 'withdraw'
  // 内部搬运：净值不变
  | 'transfer'
  // 真正的损益
  | 'realized_pnl' | 'funding_fee' | 'commission' | 'referral_kickback' | 'insurance_clear'
  | 'earn_reward' | 'margin_interest'
  // 币种之间换手：净值基本不变，但两边资产都动
  | 'convert' | 'dust'

/**
 * 三类的经济含义完全不同，筛选按它分而不是按接口分：
 *   external  钱真正进出账户，改变本金但不是盈亏
 *   income    不动本金的损益
 *   internal  净值不变，只是换了个钱包或换了个币种
 */
export type LedgerGroup = 'external' | 'income' | 'internal'

export type LedgerEntry = {
  id: string
  kind: LedgerKind
  group: LedgerGroup
  /** 这条记录是哪个接口给的。合并出来的流水，出处必须跟着走 */
  source: SourceKey
  time: string
  asset: string
  /** 合约收支才有：同一时刻三个永续一起结算资金费，不写 symbol 就分不清哪条是哪条 */
  symbol: string | null
  /**
   * 正 = 入账，负 = 出账（对该资产而言）。
   * 划转是个例外：它是一条"从哪搬到哪"的记录而不是两条腿，amount 记搬动的量，
   * 净值不因它改变——所以任何净额都不能把它算进去。
   */
  amount: number
  value_usd: number | null
  wallet: WalletKind | null
  /** 划转的对手方钱包 */
  counterparty: WalletKind | null
  /** 闪兑与小额兑换：换出去的那一边 */
  from_asset: string | null
  from_amount: number | null
  from_value_usd: number | null
  network: string | null
  tx_id: string | null
  status: 'confirmed' | 'pending' | 'failed'
}

/** 每个来源自己的窗口限制。这是页面内容的一部分，不是脚注 */
export type LedgerSourceWindow = {
  key: SourceKey
  endpoint: string
  weight: number
  /** 单次调用允许的最大区间（天）；接口没限制为 null */
  max_window_days: number | null
  /** 最多回溯多少天；接口未声明为 null */
  lookback_days: number | null
  /** 需要枚举参数才能取全时，写清楚枚举的是什么 */
  fanout: string | null
  /** covering 整个窗口需要调几次。划转要按 type 枚举，一次就是几十下 */
  calls: number
}

export type LedgerWindow = {
  from: string
  to: string
  days: number
  /** 单次可查的上限，等于各来源上限里最小的那个 */
  max_days: number
  /** 卡住上限的是哪一个来源 */
  limited_by: SourceKey
}

export type LedgerSnapshot = {
  as_of: string | null
  sources: SourceState[]
  windows: LedgerSourceWindow[]
  window: LedgerWindow
  entries: LedgerEntry[]
}
