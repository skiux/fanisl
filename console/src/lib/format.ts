/** 金融数字的格式化。精度规则写在一处，避免各组件各拍脑袋。 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

export function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return usd.format(value)
}

export function moneyCompact(value: number) {
  return Math.abs(value) >= 10_000 ? usdCompact.format(value) : usd.format(value)
}

/** 带显式正负号：盈亏必须一眼看出方向，不能靠颜色单独承担 */
export function signedMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${usd.format(Math.abs(value))}`
}

export function signedPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${(Math.abs(value) * 100).toFixed(digits)}%`
}

export function percent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/**
 * 币种数量：量级跨 10 个数量级（0.00071 PAXG 到 812,400 SHIB），
 * 固定小数位在两头都难看，按量级切精度。
 */
export function amount(value: number) {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 10_000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  if (abs >= 0.0001) return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

export function price(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value >= 1000) return usd.format(value)
  if (value >= 1) return `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
  return `$${value.toPrecision(3)}`
}

/** 稳定币不是"集中持仓"：算最大单一敞口时要排除，否则 USDT 永远是第一名 */
export const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI'])

/** USDT 计价的交易对拆回基础标的：NVDAUSDT → NVDA */
export function baseOf(symbol: string) {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol
}

/** 低于这个值算灰尘，默认折起来——真账户里灰尘条数会淹没主仓位 */
export const DUST_THRESHOLD_USD = 25

export function isDust(valueUsd: number | null) {
  return valueUsd === null || valueUsd < DUST_THRESHOLD_USD
}

export type Freshness = 'live' | 'aging' | 'stale' | 'unknown'

export function freshnessOf(asOf: string | null): { level: Freshness; ageMs: number | null } {
  if (!asOf) return { level: 'unknown', ageMs: null }
  const ageMs = Date.now() - new Date(asOf).getTime()
  if (!Number.isFinite(ageMs)) return { level: 'unknown', ageMs: null }
  if (ageMs < 3 * 60_000) return { level: 'live', ageMs }
  if (ageMs < 20 * 60_000) return { level: 'aging', ageMs }
  return { level: 'stale', ageMs }
}

export function relativeTime(asOf: string | null) {
  if (!asOf) return '从未取到'
  const ageMs = Date.now() - new Date(asOf).getTime()
  if (!Number.isFinite(ageMs)) return '时间未知'
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

export function clockTime(asOf: string | null) {
  if (!asOf) return '—'
  const date = new Date(asOf)
  const zone = 'Asia/Shanghai'
  const dayOf = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(value)
  // 当天的只给时分：一分钟前的数据再标上日期是噪音
  const sameDay = dayOf(date) === dayOf(new Date())
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: '2-digit', day: '2-digit' }),
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone,
  }).format(date)
}

export const WALLET_LABEL: Record<string, string> = {
  spot: '现货',
  usdm_futures: 'U 本位合约',
  coinm_futures: '币本位合约',
  cross_margin: '全仓杠杆',
  isolated_margin: '逐仓杠杆',
  funding: '资金账户',
  earn: '理财',
  options: '期权',
  trading_bots: '策略交易',
}

export const SOURCE_LABEL: Record<string, string> = {
  prices: '现价',
  wallets: '钱包分布',
  spot: '现货账户',
  futures: '合约账户',
  brackets: '保证金档位',
  earn: '理财持仓',
  margin: '杠杆账户',
  income: '收支流水',
  transfers: '充提记录',
  snapshots: '日快照',
  spot_open: '现货挂单',
  futures_open: '合约挂单',
  margin_open: '杠杆挂单',
  order_lists: 'OCO 组',
  algo_open: '策略单',
  order_history: '历史委托',
  trade_history: '成交记录',
  deposits: '充值记录',
  withdrawals: '提现记录',
  wallet_transfers: '钱包划转',
  earn_rewards: '理财派息',
  margin_interest: '杠杆利息',
  convert: '闪兑记录',
  dust: '小额兑换',
}

export const LEDGER_KIND_LABEL: Record<string, string> = {
  deposit: '充值',
  withdraw: '提现',
  transfer: '钱包划转',
  realized_pnl: '已实现盈亏',
  funding_fee: '资金费',
  commission: '手续费',
  referral_kickback: '返佣',
  insurance_clear: '保险清算',
  earn_reward: '理财派息',
  margin_interest: '杠杆利息',
  convert: '闪兑',
  dust: '小额兑换',
}

export const LEDGER_GROUP_LABEL: Record<string, string> = {
  external: '进出',
  income: '收支',
  internal: '内部',
}

/** 归因瀑布里每一项的语义色：中性项不该染成盈亏色 */
export type FlowKind = 'transfer' | 'gain' | 'cost' | 'anchor'

export const VENUE_LABEL: Record<string, string> = {
  spot: '现货',
  usdm: 'U 本位',
  margin: '杠杆',
}

/** origType 的中文。市价类与限价类要能一眼分开，触发类还要看出是止盈还是止损 */
export const ORDER_KIND_LABEL: Record<string, string> = {
  limit: '限价',
  market: '市价',
  limit_maker: '只挂单',
  stop: '止损限价',
  stop_market: '止损市价',
  take_profit: '止盈限价',
  take_profit_market: '止盈市价',
  trailing_stop_market: '追踪止损',
  twap: 'TWAP 策略',
  vp: '成交量占比策略',
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  new: '挂单中',
  partially_filled: '部分成交',
  filled: '已成交',
  canceled: '已撤销',
  expired: '已过期',
  rejected: '已拒绝',
}

/** 触发类订单 */
export const CONDITIONAL_KINDS = new Set([
  'stop', 'stop_market', 'take_profit', 'take_profit_market', 'trailing_stop_market',
])
