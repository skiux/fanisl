import { useEffect, useState } from 'react'
import { fetchOrders, type Scenario } from '../../api/client'
import type { Fill, Order, OrdersSnapshot, SourceKey } from '../../api/types'
import { Ticker } from '../../components/Ticker'
import { cn } from '../../lib/cn'
import {
  amount, baseOf, clockTime, CONDITIONAL_KINDS, money, ORDER_KIND_LABEL,
  ORDER_STATUS_LABEL, percent, price, signedMoney, signedPercent,
} from '../../lib/format'
import { gapOf } from '../orders/OrderTables'

type OrderView = 'open' | 'history' | 'fills'
type Phase = { kind: 'loading' } | { kind: 'ready'; snapshot: OrdersSnapshot } | { kind: 'failed' }

const SOURCES: Record<OrderView, SourceKey[]> = {
  open: ['futures_open', 'conditional_open', 'algo_open'],
  history: ['order_history'],
  fills: ['trade_history'],
}

/** Binance 的普通单、条件单和策略单已在 /orders 归一化，这里只取合约账户。 */
export function futuresOrderRows(snapshot: OrdersSnapshot) {
  return {
    open: snapshot.open.filter((order) => order.venue === 'usdm'),
    history: snapshot.history.filter((order) => order.venue === 'usdm'),
    fills: snapshot.fills.filter((fill) => fill.venue === 'usdm'),
  }
}

function sourceMissing(snapshot: OrdersSnapshot, view: OrderView) {
  return SOURCES[view].some((key) => snapshot.sources.find((source) => source.key === key)?.status !== 'ok')
}

export function PerpOrders({ scenario, asOf }: { scenario: Scenario; asOf: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [view, setView] = useState<OrderView>('open')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setPhase((current) => current.kind === 'ready' ? current : { kind: 'loading' })
    fetchOrders(scenario, '', controller.signal, { venue: 'usdm' })
      .then((snapshot) => { if (!controller.signal.aborted) setPhase({ kind: 'ready', snapshot }) })
      .catch(() => { if (!controller.signal.aborted) setPhase({ kind: 'failed' }) })
    return () => controller.abort()
  }, [scenario, asOf, retry])

  const rows = phase.kind === 'ready' ? futuresOrderRows(phase.snapshot) : null
  const query = phase.kind === 'ready' ? phase.snapshot.query : null
  const activeRows = rows?.[view] ?? []
  const missing = phase.kind === 'ready' && sourceMissing(phase.snapshot, view)
  const labels: { key: OrderView; label: string }[] = [
    { key: 'open', label: '挂单' }, { key: 'history', label: '历史' }, { key: 'fills', label: '成交' },
  ]

  return (
    <section className="min-w-0" aria-label="合约委托">
      <div className="flex items-end justify-between gap-3 border-b border-rule">
        <div aria-label="合约委托分类" className="flex gap-5" role="tablist">
          {labels.map(({ key, label }) => (
            <button
              aria-controls="perp-order-panel"
              aria-selected={view === key}
              className={cn('relative pb-2.5 text-sm transition-colors duration-200',
                view === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
              id={`perp-order-${key}`}
              key={key}
              onClick={() => setView(key)}
              role="tab"
              type="button"
            >
              {label}
              {view === key && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-ink" />}
            </button>
          ))}
        </div>
        {rows && <span className="tnum pb-2.5 text-xs text-ink-3">
          {view !== 'open' && query?.lookback_days && `${query.lookback_days} 天 · `}
          {activeRows.length}
        </span>}
      </div>

      <div aria-labelledby={`perp-order-${view}`} id="perp-order-panel" role="tabpanel">
        {phase.kind === 'loading' && <p className="py-10 text-sm text-ink-3">读取中…</p>}
        {phase.kind === 'failed' && (
          <div className="flex items-center justify-between gap-4 py-8 text-sm text-ink-3">
            <span>委托暂时无法读取</span>
            <button className="text-ink underline underline-offset-4" onClick={() => setRetry((n) => n + 1)} type="button">重试</button>
          </div>
        )}
        {rows && (
          <>
            {missing && <p className="border-b border-rule py-3 text-xs text-loss">部分{view === 'open' ? '挂单' : view === 'history' ? '历史' : '成交'}未取到</p>}
            {activeRows.length === 0 && !missing && <p className="py-10 text-center text-sm text-ink-3">暂无{view === 'open' ? '挂单' : view === 'history' ? '委托历史' : '成交记录'}</p>}
            <ul className="divide-y divide-rule lg:scroll-y lg:max-h-[min(52dvh,38rem)]">
              {view === 'fills'
                ? (activeRows as Fill[]).map((fill) => <FillRow fill={fill} key={fill.id} />)
                : (activeRows as Order[]).map((order) => <OrderRow key={order.id} order={order} />)}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function OrderRow({ order }: { order: Order }) {
  const trigger = order.stop_price ?? order.activate_price
  const target = trigger ?? order.price
  const active = order.status === 'new' || order.status === 'partially_filled'
  const closeAll = order.close_position && order.orig_qty === 0
  const gap = gapOf(order)
  const levelLabel = order.kind === 'twap' || order.kind === 'vp' ? '成交均价'
    : order.activate_price !== null && order.stop_price === null ? '激活'
      : trigger !== null ? '触发' : '委托'
  return (
    <li className="py-4 first:pt-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Ticker asset={baseOf(order.symbol)} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{baseOf(order.symbol)}</div>
            <div className="truncate text-xs text-ink-3">
              {order.side === 'buy' ? '买入' : '卖出'} · {ORDER_KIND_LABEL[order.kind] ?? order.kind}
              {order.close_position ? ' · 全平' : order.reduce_only ? ' · 只减仓' : ''}
            </div>
          </div>
        </div>
        <div className="min-w-0 shrink-0 text-right">
          <div className="tnum text-sm text-ink">{active
            ? closeAll ? '全平仓位' : money(order.notional_usd)
            : ORDER_STATUS_LABEL[order.status] ?? order.status}</div>
          <div className="tnum mt-1 text-xs text-ink-3">{clockTime(order.created_at)} ET</div>
        </div>
      </div>
      <div className="tnum mt-2.5 flex flex-wrap gap-x-3 gap-y-1 pl-[34px] text-xs text-ink-2">
        <span>{levelLabel} {target === null
          ? order.kind === 'twap' || order.kind === 'vp' ? '—' : '市价'
          : price(target)}</span>
        <span>{closeAll ? '数量 全部仓位' : `数量 ${amount(order.orig_qty)}`}</span>
        {order.executed_qty > 0 && <span>已成交 {amount(order.executed_qty)}</span>}
      </div>
      {(CONDITIONAL_KINDS.has(order.kind) || order.status === 'partially_filled'
        || order.position_side === 'long' || order.position_side === 'short'
        || order.time_in_force === 'GTD') && (
        <div className="tnum mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-[34px] text-xs text-ink-3">
          {order.position_side === 'long' && <span>多头</span>}
          {order.position_side === 'short' && <span>空头</span>}
          {order.trigger_by && <span>{order.trigger_by === 'mark' ? '标记价触发' : '成交价触发'}</span>}
          {order.callback_rate !== null && <span>回调 {percent(order.callback_rate, 1)}</span>}
          {active && CONDITIONAL_KINDS.has(order.kind) && gap !== null
            && <span>距{order.activate_price !== null && order.stop_price === null ? '激活' : '触发'} {signedPercent(gap, 1)}</span>}
          {order.time_in_force === 'GTD' && order.good_till_date
            && <span>截至 {clockTime(order.good_till_date)} ET</span>}
          {order.status === 'partially_filled' && <span>部分成交</span>}
        </div>
      )}
    </li>
  )
}

function FillRow({ fill }: { fill: Fill }) {
  return (
    <li className="py-4 first:pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Ticker asset={baseOf(fill.symbol)} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{baseOf(fill.symbol)}</div>
            <div className="text-xs text-ink-3">{fill.side === 'buy' ? '买入' : '卖出'} · {clockTime(fill.time)} ET</div>
          </div>
        </div>
        <span className="tnum text-right text-sm text-ink">{money(fill.quote_qty)}</span>
      </div>
      <div className="tnum mt-2.5 flex flex-wrap gap-x-4 gap-y-1 pl-[34px] text-xs text-ink-2">
        <span>{price(fill.price)} × {amount(fill.qty)}</span>
        {fill.is_maker !== null && <span>{fill.is_maker ? '挂单成交' : '吃单成交'}</span>}
        {fill.commission !== null && <span>手续费 −{amount(fill.commission)} {fill.commission_asset}</span>}
        {fill.realized_pnl !== null && fill.realized_pnl !== 0 && <span className={fill.realized_pnl > 0 ? 'text-gain' : 'text-loss'}>已实现 {signedMoney(fill.realized_pnl)}</span>}
      </div>
    </li>
  )
}
