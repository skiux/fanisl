import { useEffect, useId, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { fetchOrders, type Scenario } from '../../api/client'
import type { Fill, Order, OrdersSnapshot, OrderVenue, SourceKey } from '../../api/types'
import { Ticker } from '../../components/Ticker'
import { cn } from '../../lib/cn'
import {
  amount, clockTime, money, ORDER_KIND_LABEL, ORDER_STATUS_LABEL, price,
  splitPair, VENUE_LABEL,
} from '../../lib/format'
import { prefetchPageData, usePageData } from '../../lib/pageData'
import { orderValue } from '../../lib/orders'
import { ListSkeleton } from './states'
import { useViewportListHeight } from './useViewportListHeight'

type OrderView = 'open' | 'history'
type HoldingsVenue = Exclude<OrderVenue, 'usdm'>
type Loaded = {
  snapshots: Partial<Record<HoldingsVenue, OrdersSnapshot>>
  failed: HoldingsVenue[]
}
type HistoryStatus = 'all' | 'filled' | 'canceled' | 'expired' | 'rejected'

const HOLDINGS_VENUES = new Set<OrderVenue>(['spot', 'margin', 'equity'])
const CLOSED_STATUSES = new Set<Order['status']>(['filled', 'canceled', 'expired', 'rejected'])
const HISTORY_SOURCES: SourceKey[] = ['order_history', 'trade_history']
const OPEN_SOURCE: Record<HoldingsVenue, SourceKey> = {
  spot: 'spot_open', margin: 'margin_open', equity: 'equity_open',
}
const VENUE_ORDER: HoldingsVenue[] = ['spot', 'margin', 'equity']
const HISTORY_FILTERS: { status: HistoryStatus; label: string }[] = [
  { status: 'all', label: '全部' },
  { status: 'filled', label: '已成交' },
  { status: 'canceled', label: '已撤销' },
  { status: 'expired', label: '已过期' },
  { status: 'rejected', label: '已拒绝' },
]

/** 每个账户的委托单独保留；历史按下单时刻，而不是最后成交或撤销时刻排序。 */
export function holdingsOrderRows(input: OrdersSnapshot | OrdersSnapshot[]) {
  const snapshots = Array.isArray(input) ? input : [input]
  const open = snapshots.flatMap((snapshot) => snapshot.open)
  const past = snapshots.flatMap((snapshot) => snapshot.history)
  const history = past.filter((order) => HOLDINGS_VENUES.has(order.venue)
    && CLOSED_STATUSES.has(order.status)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const closedIds = new Set(history.map((order) => order.id))
  return {
    open: open.filter((order) => HOLDINGS_VENUES.has(order.venue)
      && !CLOSED_STATUSES.has(order.status) && !closedIds.has(order.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    history,
    fills: snapshots.flatMap((snapshot) => snapshot.fills)
      .filter((fill) => HOLDINGS_VENUES.has(fill.venue)),
  }
}

/**
 * 三个账户的委托。同一批 Binance 基础端点有短缓存：串行读，避免冷缓存时并发重复请求。
 * 某个账户读失败只记下来，其余照常显示。
 *
 * 走页面数据缓存（lib/pageData.ts），持仓页一打开就预取（`prefetchHoldingsOrders`）。
 * 原先点开「委托」才取、而且资产页每分钟刷新一次它就清空重取一次，一直在闪「读取中…」。
 */
const holdingsOrders = (scenario: Scenario) => ({
  scope: `holdings-orders|${scenario}`,
  load: async (signal: AbortSignal, force = false): Promise<Loaded> => {
    const snapshots: Loaded['snapshots'] = {}
    const failed: HoldingsVenue[] = []
    for (const venue of VENUE_ORDER) {
      try {
        snapshots[venue] = await fetchOrders(scenario, '', signal, { venue, force })
      } catch (error) {
        if (signal.aborted) throw error
        failed.push(venue)
      }
    }
    if (failed.length === VENUE_ORDER.length) throw new Error('委托暂时无法读取')
    return { snapshots, failed }
  },
})

export function prefetchHoldingsOrders(scenario: Scenario) {
  const { scope, load } = holdingsOrders(scenario)
  prefetchPageData(scope, '', load)
}

function sourceMissing(snapshots: Loaded['snapshots'], view: OrderView) {
  return VENUE_ORDER.some((venue) => {
    const snapshot = snapshots[venue]
    if (!snapshot) return true
    const sources = view === 'open' ? [OPEN_SOURCE[venue]] : HISTORY_SOURCES
    return sources.some((key) => {
      const status = snapshot.sources.find((source) => source.key === key)?.status
      return status !== 'ok' && status !== 'unsupported'
    })
  })
}

export function HoldingsOrders({ scenario }: { scenario: Scenario }) {
  const { phase, retry } = usePageData({
    ...holdingsOrders(scenario),
    failure: '委托暂时无法读取',
    refreshEveryMs: 60_000,
    autoRefresh: scenario === 'live',
  })
  const [view, setView] = useState<OrderView>('open')
  const [venue, setVenue] = useState<HoldingsVenue | 'all'>('all')
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('all')
  const { ref: listRef, height: listHeight } = useViewportListHeight()

  const data = phase.kind === 'ready' ? phase.snapshot : null
  const rows = data ? holdingsOrderRows(Object.values(data.snapshots)) : null
  const venueOptions = VENUE_ORDER.filter((key) => (rows?.[view] ?? []).some((order) => order.venue === key))
  const selectedVenue = venue === 'all' || venueOptions.includes(venue) ? venue : 'all'
  const activeRows = (rows?.[view] ?? []).filter((order) =>
    (selectedVenue === 'all' || order.venue === selectedVenue)
    && (view === 'open' || historyStatus === 'all' || order.status === historyStatus))
  const visibleStatuses = HISTORY_FILTERS.filter(({ status }) => status === 'all' || status === 'filled'
    || (rows?.history ?? []).some((order) => order.status === status))
  const incomplete = data !== null && (data.failed.length > 0 || sourceMissing(data.snapshots, view))
  const fillsByOrder = new Map<string, Fill[]>()
  for (const fill of rows?.fills ?? []) {
    const matches = fillsByOrder.get(fill.order_id) ?? []
    matches.push(fill)
    fillsByOrder.set(fill.order_id, matches)
  }

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0 }, [view, venue, historyStatus, listRef])

  return (
    <section aria-label="持仓委托" className="min-w-0">
      <div className="flex items-end justify-between gap-3 border-b border-rule">
        <div aria-label="持仓委托分类" className="flex gap-5" role="tablist">
          {(['open', 'history'] as const).map((key) => (
            <button
              aria-controls="holdings-order-panel"
              aria-selected={view === key}
              className={cn('relative pb-2.5 text-sm transition-colors duration-200',
                view === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
              id={`holdings-order-${key}`}
              key={key}
              onClick={() => { setView(key); setVenue('all') }}
              role="tab"
              type="button"
            >
              {key === 'open' ? '当前委托' : '历史委托'}
              {view === key && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-ink" />}
            </button>
          ))}
        </div>
        {/* 与合约页同一个写法：当前委托带委托价值（按上面选的账户筛过），来源不全时不报 */}
        {rows && !incomplete && <span className="tnum flex items-baseline gap-3 pb-2.5 text-xs text-ink-3">
          {view === 'open' && <span data-order-value>
            委托价值 <span className="text-ink-2">{money(orderValue(activeRows))}</span>
          </span>}
          <span data-order-count>{activeRows.length}</span>
        </span>}
        {rows && incomplete && <button
          aria-label="重新读取委托"
          className="pb-2.5 text-xs text-ink-2 underline decoration-rule-strong underline-offset-4 transition-colors hover:text-ink"
          onClick={retry}
          type="button"
        >重试</button>}
      </div>

      <div aria-labelledby={`holdings-order-${view}`} id="holdings-order-panel" role="tabpanel">
        {(venueOptions.length > 1 || (view === 'history' && rows)) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 py-3">
            {venueOptions.length > 1 && <div aria-label="委托账户" className="flex flex-wrap gap-1.5" role="group">
              {(['all', ...venueOptions] as const).map((key) => <FilterButton
                active={selectedVenue === key}
                key={key}
                label={key === 'all' ? '全部账户' : VENUE_LABEL[key]}
                onClick={() => setVenue(key)}
              />)}
            </div>}
            {view === 'history' && rows && <div aria-label="历史委托状态" className="flex flex-wrap gap-1.5" role="group">
              {visibleStatuses.map(({ status, label }) => <FilterButton
                active={historyStatus === status}
                key={status}
                label={label}
                onClick={() => setHistoryStatus(status)}
              />)}
            </div>}
          </div>
        )}
        {phase.kind === 'loading' && <ListSkeleton label="正在读取持仓委托" />}
        {phase.kind === 'failed' && (
          <div className="flex items-center justify-between gap-4 py-8 text-sm text-ink-3">
            <span>委托暂时无法读取</span>
            <button className="text-ink underline underline-offset-4" onClick={retry} type="button">重试</button>
          </div>
        )}
        {rows && <>
          {activeRows.length === 0 && <p className="py-10 text-center text-sm text-ink-3">
            {incomplete ? '委托暂不可用' : view === 'history' && historyStatus !== 'all'
              ? `暂无${HISTORY_FILTERS.find(({ status }) => status === historyStatus)?.label}委托`
              : `暂无${view === 'open' ? '当前委托' : '历史委托'}`}
          </p>}
          <ul
            aria-label={view === 'open' ? '当前持仓委托列表' : '历史持仓委托列表'}
            className="scroll-y divide-y divide-rule"
            data-scroll-region="holdings-orders"
            ref={listRef}
            style={{ maxHeight: listHeight ?? undefined }}
            tabIndex={listHeight !== null ? 0 : undefined}
          >
            {activeRows.map((order) => <OrderRow
              fills={view === 'history' ? fillsByOrder.get(order.id) ?? [] : []}
              key={order.id}
              order={order}
            />)}
          </ul>
        </>}
      </div>
    </section>
  )
}

function FilterButton({ active, label, onClick }: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return <button
    aria-pressed={active}
    className={cn('rounded-full px-3 py-1.5 text-xs transition-colors duration-200',
      active ? 'bg-ink text-sheet' : 'text-ink-3 hover:bg-sheet-2 hover:text-ink')}
    onClick={onClick}
    type="button"
  >{label}</button>
}

function OrderRow({ order, fills }: { order: Order; fills: Fill[] }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const { base, quote } = splitPair(order.symbol)
  const active = order.status === 'new' || order.status === 'partially_filled'
  const target = order.stop_price ?? order.activate_price ?? order.price
  const targetLabel = order.stop_price !== null ? '触发'
    : order.activate_price !== null ? '激活' : '委托'
  const tradingSession = order.trading_session && ({
    rth: '常规', extended: '盘前后', '24h': '24H',
  } as const)[order.trading_session]

  return <li className="py-4 first:pt-3">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Ticker asset={base} size="sm" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium text-ink">{base}</span>
            <span className="shrink-0 rounded-[4px] bg-sheet-2 px-1.5 py-px text-[9.5px] text-ink-2">
              {VENUE_LABEL[order.venue]}
            </span>
            {order.order_list_id && <span className="text-micro text-ink-3">OCO</span>}
          </div>
          <div className="truncate text-xs text-ink-3">
            {order.side === 'buy' ? '买入' : '卖出'} · {ORDER_KIND_LABEL[order.kind] ?? order.kind}
            {tradingSession && ` · ${tradingSession}`}
          </div>
        </div>
      </div>
      <div className="min-w-0 shrink-0 text-right">
        <div className="tnum text-sm text-ink">
          {active ? money(order.notional_usd) : ORDER_STATUS_LABEL[order.status] ?? order.status}
        </div>
        <div className="tnum mt-1 text-xs text-ink-3">{clockTime(order.created_at)} ET</div>
      </div>
    </div>
    <div className="tnum mt-2.5 flex flex-wrap gap-x-3 gap-y-1 pl-[34px] text-xs text-ink-2">
      <span>{target === null ? '市价' : `${targetLabel} ${price(target)}${quote ? ` ${quote}` : ''}`}</span>
      <span>数量 {amount(order.orig_qty)}{order.venue === 'equity' ? ' 股' : ''}</span>
      {order.executed_qty > 0 && <span>已成交 {amount(order.executed_qty)}</span>}
    </div>
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
          {fills.map((fill) => <FillDetail fill={fill} key={fill.id} quote={order.quote_asset ?? quote} />)}
        </ul>
      </div>
    </>}
  </li>
}

function FillDetail({ fill, quote }: { fill: Fill; quote: string | null }) {
  return <li className="py-2.5 text-xs">
    <div className="tnum flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-ink-2">
      <span>{clockTime(fill.time)} ET · {price(fill.price)} × {amount(fill.qty)}</span>
      <span className="text-ink">{amount(fill.quote_qty)}{quote ? ` ${quote}` : ''}</span>
    </div>
    {(fill.is_maker !== null || fill.commission !== null) && (
      <div className="tnum mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
        {fill.is_maker !== null && <span>{fill.is_maker ? '挂单成交' : '吃单成交'}</span>}
        {fill.commission !== null && <span>手续费 −{amount(fill.commission)} {fill.commission_asset}</span>}
      </div>
    )}
  </li>
}
