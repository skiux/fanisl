import { useEffect, useId, useState } from 'react'
import { fetchOrders, type Scenario } from '../../api/client'
import type { Fill, Order, OrdersSnapshot, SourceKey } from '../../api/types'
import { CaretDown } from '@phosphor-icons/react'
import { Ticker } from '../../components/Ticker'
import { cn } from '../../lib/cn'
import {
  amount, baseOf, clockTime, CONDITIONAL_KINDS, money, ORDER_KIND_LABEL,
  ORDER_STATUS_LABEL, percent, price, signedMoney, signedPercent, SOURCE_LABEL,
} from '../../lib/format'
import { prefetchPageData, usePageData } from '../../lib/pageData'
import { gapOf } from '../orders/OrderTables'
import { ListSkeleton } from './states'
import { useViewportListHeight } from './useViewportListHeight'

type OrderView = 'open' | 'history'

/**
 * 合约委托的取数。走页面数据缓存（lib/pageData.ts）：点开过一次之后再点开，第一帧就是
 * 上一次的数据，再在后台静默复核；面板开着时每分钟自己刷新。合约页一打开就预取
 * （`prefetchPerpOrders`），所以点「委托」通常一个占位都看不到。
 */
const perpOrders = (scenario: Scenario) => ({
  scope: `perp-orders|${scenario}`,
  load: (signal: AbortSignal, force = false) =>
    fetchOrders(scenario, '', signal, { venue: 'usdm', force }),
})

export function prefetchPerpOrders(scenario: Scenario) {
  const { scope, load } = perpOrders(scenario)
  prefetchPageData(scope, '', load)
}

const SOURCES: Record<OrderView, SourceKey[]> = {
  open: ['futures_open', 'conditional_open', 'algo_open'],
  history: ['order_history', 'trade_history'],
}
const CLOSED_STATUSES = new Set<Order['status']>(['filled', 'canceled', 'expired', 'rejected'])
type HistoryStatus = 'all' | 'filled' | 'canceled' | 'expired' | 'rejected'
const HISTORY_FILTERS: { status: HistoryStatus; label: string }[] = [
  { status: 'all', label: '全部' },
  { status: 'filled', label: '已成交' },
  { status: 'canceled', label: '已撤销' },
  { status: 'expired', label: '已过期' },
  { status: 'rejected', label: '已拒绝' },
]

/** Binance 的普通单、条件单和策略单已在 /orders 归一化，这里只取合约账户。 */
export function futuresOrderRows(snapshot: OrdersSnapshot) {
  const closed = snapshot.history.filter((order) => order.venue === 'usdm' && CLOSED_STATUSES.has(order.status))
  const closedIds = new Set(closed.map((order) => order.id))
  return {
    open: snapshot.open.filter((order) => order.venue === 'usdm'
      && !CLOSED_STATUSES.has(order.status) && !closedIds.has(order.id)),
    history: closed.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    fills: snapshot.fills.filter((fill) => fill.venue === 'usdm'),
  }
}

function missingSourceKeys(snapshot: OrdersSnapshot, view: OrderView) {
  return SOURCES[view].filter((key) => {
    const status = snapshot.sources.find((source) => source.key === key)?.status
    // 该账户未启用的委托类型不是暂时读取失败；反复点重试也不会出现数据。
    return status !== 'ok' && status !== 'unsupported'
  })
}

export function sourceMissing(snapshot: OrdersSnapshot, view: OrderView) {
  return missingSourceKeys(snapshot, view).length > 0
}

export function PerpOrders({ scenario }: { scenario: Scenario }) {
  const { phase, retry } = usePageData({
    ...perpOrders(scenario),
    failure: '委托暂时无法读取',
    refreshEveryMs: 60_000,
    autoRefresh: scenario === 'live',
  })
  const [view, setView] = useState<OrderView>('open')
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('all')
  const { ref: listRef, height: listHeight } = useViewportListHeight()

  const rows = phase.kind === 'ready' ? futuresOrderRows(phase.snapshot) : null
  const query = phase.kind === 'ready' ? phase.snapshot.query : null
  const activeRows = view === 'history' && historyStatus !== 'all'
    ? (rows?.history ?? []).filter((order) => order.status === historyStatus)
    : rows?.[view] ?? []
  const visibleFilters = HISTORY_FILTERS.filter(({ status }) => status === 'all' || status === 'filled'
    || (rows?.history ?? []).some((order) => order.status === status))
  const missingKeys = phase.kind === 'ready' ? missingSourceKeys(phase.snapshot, view) : []
  const missing = missingKeys.length > 0
  const missingNames = missingKeys.map((key) => SOURCE_LABEL[key] ?? key)
  const labels: { key: OrderView; label: string }[] = [
    { key: 'open', label: '当前委托' }, { key: 'history', label: '历史委托' },
  ]
  const fillsByOrder = new Map<string, Fill[]>()
  for (const fill of rows?.fills ?? []) {
    const matches = fillsByOrder.get(fill.order_id) ?? []
    matches.push(fill)
    fillsByOrder.set(fill.order_id, matches)
  }

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0 }, [view, historyStatus, listRef])

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
        {rows && !missing && <span className="tnum pb-2.5 text-xs text-ink-3" data-order-count>
          {view !== 'open' && query?.lookback_days && `${query.lookback_days} 天 · `}
          {activeRows.length}
        </span>}
        {rows && missing && <button
          aria-label="重新读取委托"
          className="pb-2.5 text-xs text-ink-2 underline decoration-rule-strong underline-offset-4 transition-colors hover:text-ink"
          onClick={retry}
          title={`${missingNames.join('、')}未更新`}
          type="button"
        >重试</button>}
      </div>

      <div aria-labelledby={`perp-order-${view}`} id="perp-order-panel" role="tabpanel">
        {view === 'history' && rows && <div aria-label="历史委托状态" className="flex flex-wrap gap-1.5 pt-3" role="group">
          {visibleFilters.map(({ status, label }) => <button
            aria-pressed={historyStatus === status}
            className={cn('rounded-full px-3 py-1.5 text-xs transition-colors duration-200',
              historyStatus === status ? 'bg-ink text-sheet' : 'text-ink-3 hover:bg-sheet-2 hover:text-ink')}
            key={status}
            onClick={() => setHistoryStatus(status)}
            type="button"
          >{label}</button>)}
        </div>}
        {phase.kind === 'loading' && <ListSkeleton label="正在读取合约委托" />}
        {phase.kind === 'failed' && (
          <div className="flex items-center justify-between gap-4 py-8 text-sm text-ink-3">
            <span>委托暂时无法读取</span>
            <button className="text-ink underline underline-offset-4" onClick={retry} type="button">重试</button>
          </div>
        )}
        {rows && (
          <>
            {activeRows.length === 0 && <p className="py-10 text-center text-sm text-ink-3">
              {missing ? '委托暂不可用' : view === 'history' && historyStatus !== 'all'
                ? `暂无${HISTORY_FILTERS.find(({ status }) => status === historyStatus)?.label}委托`
                : `暂无${view === 'open' ? '当前委托' : '历史委托'}`}
            </p>}
            <ul aria-label={view === 'history' ? '历史委托列表' : '当前委托列表'}
              className="scroll-y divide-y divide-rule" data-scroll-region="perp-orders"
              ref={listRef} style={{ maxHeight: listHeight ?? undefined }}
              tabIndex={listHeight !== null ? 0 : undefined}>
              {activeRows.map((order) => <OrderRow
                fills={view === 'history' ? fillsByOrder.get(order.id) ?? [] : []}
                key={order.id}
                order={order}
              />)}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function OrderRow({ order, fills }: { order: Order; fills: Fill[] }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
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
          <div className="tnum mt-1 text-xs text-ink-3">
            {clockTime(order.created_at)} ET
          </div>
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
      {fills.length > 0 && <>
        <button
          aria-controls={detailsId}
          aria-expanded={expanded}
          className="ml-[34px] mt-2 flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          成交明细 <span className="tnum">{fills.length}</span>
          <CaretDown aria-hidden="true" className={cn('transition-transform duration-300', expanded && 'rotate-180')} size={12} />
        </button>
        <div aria-hidden={!expanded} className="collapsible" data-open={expanded} id={detailsId}>
          <ul className="ml-[34px] divide-y divide-rule/70 overflow-hidden">
            {fills.map((fill) => <FillDetail fill={fill} key={fill.id} />)}
          </ul>
        </div>
      </>}
    </li>
  )
}

function FillDetail({ fill }: { fill: Fill }) {
  return (
    <li className="py-2.5 text-xs">
      <div className="tnum flex items-baseline justify-between gap-3 text-ink-2">
        <span>{clockTime(fill.time)} ET · {price(fill.price)} × {amount(fill.qty)}</span>
        <span className="shrink-0 text-ink">{money(fill.quote_qty)}</span>
      </div>
      <div className="tnum mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
        {fill.is_maker !== null && <span>{fill.is_maker ? '挂单成交' : '吃单成交'}</span>}
        {fill.commission !== null && <span>手续费 −{amount(fill.commission)} {fill.commission_asset}</span>}
        {fill.realized_pnl !== null && fill.realized_pnl !== 0 && <span className={fill.realized_pnl > 0 ? 'text-gain' : 'text-loss'}>已实现 {signedMoney(fill.realized_pnl)}</span>}
      </div>
    </li>
  )
}
