// 交易评测共用：领域标签映射 + 数字/时间格式化

export const usd = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

export const signedUsd = (n: number | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n)
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export const num = (n: number | null | undefined, d = 2) => (n == null ? '—' : Number(n).toFixed(d))

export const pct = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${Number(n).toFixed(d)}%`)

export const signedPct = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(d)}%`

export const rr = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}R`

export const dur = (s: number | null | undefined) => {
  if (s == null) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

export const when = (ts?: string | null) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const whenSec = (ts?: string | null) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${when(ts)}:${String(d.getSeconds()).padStart(2, '0')}`
}

export const sym = (s: string) => s.replace(':USDT', '').replace('/USDT', '')

// --- 领域枚举 → 中文标签（与 backend trading/models.py 的 Literal 对应）---

export const SIDE: Record<string, string> = { long: '做多', short: '做空' }

export const STATUS: Record<string, string> = {
  planned: '挂单中', open: '持仓中', closed: '已平仓', cancelled: '已取消',
}

export const OUTCOME: Record<string, string> = { win: '盈', loss: '亏', breakeven: '平' }

export const STRATEGY: Record<string, string> = {
  trend: '趋势', mean_reversion: '均值回归', breakout: '突破',
  event_driven: '事件驱动', carry: '套息', other: '其他',
}

export const REGIME: Record<string, string> = { trend: '趋势市', range: '震荡市', unknown: '不明' }

export const EXIT_REASON: Record<string, string> = {
  tp: '止盈', sl: '止损', liquidation: '强平', manual: '主动平仓',
  thesis_invalidated: '论点失效', time_stop: '时间止损',
}

export const SKILL_LUCK: Record<string, string> = {
  right_judgment_profit: '判断对 · 赚（真本事）',
  right_judgment_loss: '判断对 · 亏（运气差）',
  wrong_judgment_profit: '判断错 · 赚（运气好）',
  wrong_judgment_loss: '判断错 · 亏（该认的错）',
}

export const SKILL_LUCK_SHORT: Record<string, string> = {
  right_judgment_profit: '对·赚',
  right_judgment_loss: '对·亏',
  wrong_judgment_profit: '错·赚',
  wrong_judgment_loss: '错·亏',
}

export const WAKE: Record<string, string> = {
  price_above: '价 ≥', price_below: '价 ≤',
  pnl_pct_above: '浮盈 ≥', pnl_pct_below: '浮亏 ≤', time_elapsed_hours: '持仓 ≥',
}

export const ADJ_ACTION: Record<string, string> = {
  hold: '持有', move_sl: '移止损', partial_exit: '部分止盈', add: '加仓', close: '平仓',
}

export const ORDER_KIND: Record<string, string> = {
  entry: '进场', add: '加仓', tp: '止盈', sl: '止损',
  reduce: '减仓', exit: '出场', liquidation: '强平',
}

export const EVENT_KIND: Record<string, string> = {
  entry_pending: '挂单等待', opened: '开仓', closed: '平仓',
  plan_rejected: '计划被拒', plan_flagged: '计划被标记',
  needs_review: '触发复评',
  adjust_hold: '管理 · 持有', adjust_move_sl: '管理 · 移止损',
  adjust_partial_exit: '管理 · 部分止盈', adjust_add: '管理 · 加仓', adjust_close: '管理 · 平仓',
  tp_fill: '止盈成交', sl_fill: '止损成交', exit_fill: '出场成交',
  reduce_fill: '减仓成交', liquidation_fill: '强平成交',
  manage_error: '管理出错', review_error: '复盘出错',
}
