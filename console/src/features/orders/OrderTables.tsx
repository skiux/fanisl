import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import {
  amount, money, ORDER_KIND_LABEL, ORDER_STATUS_LABEL, percent, price,
  relativeTime, signedMoney, signedPercent, VENUE_LABEL,
} from '../../lib/format'
import type { Fill, Order } from '../../api/types'

/** 账户角标。方向已经用箭头表达，这里保持中性色，绿红只留给盈亏 */
function VenueTag({ venue }: { venue: Order['venue'] }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-[4px] bg-sheet-2 px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-wider text-ink-2">
      {VENUE_LABEL[venue] ?? venue}
    </span>
  )
}

function SideKind({ order }: { order: Order }) {
  const buy = order.side === 'buy'
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-sm text-ink">
        {buy
          ? <ArrowUp aria-hidden="true" className="shrink-0 text-ink-2" size={11} weight="bold" />
          : <ArrowDown aria-hidden="true" className="shrink-0 text-ink-2" size={11} weight="bold" />}
        <span>{buy ? '买入' : '卖出'}</span>
      </div>
      <div className="truncate text-micro text-ink-3">
        {ORDER_KIND_LABEL[order.kind] ?? order.kind}
        {order.time_in_force && order.time_in_force !== 'GTC' && ` · ${order.time_in_force}`}
      </div>
    </div>
  )
}

function SymbolCell({ order }: { order: Order }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm text-ink">{order.symbol}</span>
        <VenueTag venue={order.venue} />
        {order.order_list_id && (
          <span className="rounded-[4px] border border-accent/40 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-accent">
            OCO
          </span>
        )}
      </div>
      <div className="tnum truncate text-micro text-ink-3">{relativeTime(order.created_at)}</div>
    </div>
  )
}

/** 委托价（或触发价）离现价还有多远。这不是盈亏，所以不染绿红，只用接近度点亮 */
export function gapOf(order: Order) {
  const target = order.stop_price ?? order.price ?? order.activate_price
  if (target === null || order.reference_price === null || order.reference_price === 0) return null
  return (target - order.reference_price) / order.reference_price
}

function Gap({ order, label }: { order: Order; label: string }) {
  const gap = gapOf(order)
  if (gap === null) return <span className="text-micro text-ink-3">无报价</span>
  // 15% 以外一律算"远"，近的点亮：条越满代表越快会触发
  const closeness = Math.max(0, 1 - Math.min(1, Math.abs(gap) / 0.15))
  const near = Math.abs(gap) < 0.03
  return (
    <div className="min-w-0">
      <div className={cn('tnum text-sm', near ? 'text-accent' : 'text-ink-2')}>{signedPercent(gap, 1)}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="h-[3px] w-full overflow-hidden rounded-full bg-rule">
          <span
            className={cn('block h-full rounded-full transition-[width] duration-500', near ? 'bg-accent' : 'bg-ink-3')}
            style={{ width: `${(closeness * 100).toFixed(1)}%` }}
          />
        </span>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

function Filled({ order }: { order: Order }) {
  const ratio = order.orig_qty > 0 ? order.executed_qty / order.orig_qty : 0
  return (
    <div className="min-w-0">
      <div className="tnum truncate text-sm text-ink-2">{amount(order.orig_qty)}</div>
      {order.executed_qty > 0 ? (
        <div className="tnum truncate text-micro text-ink-3">已成交 {percent(ratio, 0)}</div>
      ) : (
        <div className="text-micro text-ink-3">未成交</div>
      )}
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="py-10 text-center text-sm text-ink-3">{children}</p>
}

const LIMIT_ROW = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_104px]'

export function LimitOrderTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <Empty>没有限价挂单。</Empty>
  return (
    <>
      <div className={cn(LIMIT_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>交易对</span>
        <span className="hidden sm:block">方向</span>
        <span className="hidden sm:block">委托价</span>
        <span className="hidden sm:block">数量</span>
        <span className="text-right sm:text-left">名义</span>
        <span className="hidden sm:block">距成交</span>
      </div>
      <ul className="divide-y divide-rule">
        {orders.map((order) => (
          <li className={cn(LIMIT_ROW, 'py-3 transition-colors duration-200 hover:bg-sheet-2/45')} key={order.id}>
            <SymbolCell order={order} />
            <div className="hidden sm:block"><SideKind order={order} /></div>
            <div className="tnum hidden truncate text-sm text-ink sm:block">{price(order.price)}</div>
            <div className="hidden sm:block"><Filled order={order} /></div>
            <div className="tnum truncate text-right text-sm text-ink-2 sm:text-left">
              {money(order.notional_usd)}
            </div>
            <div className="hidden sm:block"><Gap label="距成交" order={order} /></div>
          </li>
        ))}
      </ul>
    </>
  )
}

const COND_ROW = 'grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_76px]'

/**
 * 条件单的列和限价单不是一套：这里要看的是触发价、按什么价触发、触发后干什么。
 * 排得比限价单窄——它天生行数少，和限价单并排放正好把一行填满。
 */
export function ConditionalOrderTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <Empty>没有条件单。</Empty>
  return (
    <>
      <div className={cn(COND_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>交易对</span>
        <span className="hidden sm:block">触发价</span>
        <span className="hidden sm:block">触发后</span>
        <span>距触发</span>
      </div>
      <ul className="divide-y divide-rule">
        {orders.map((order) => (
          <li className={cn(COND_ROW, 'py-2.5 transition-colors duration-200 hover:bg-sheet-2/45')} key={order.id}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-ink">{order.symbol}</span>
                <VenueTag venue={order.venue} />
                {order.order_list_id && (
                  <span className="rounded-[4px] border border-accent/40 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-accent">
                    OCO
                  </span>
                )}
              </div>
              <div className="truncate text-micro text-ink-3">
                {order.side === 'buy' ? '买入' : '卖出'} · {ORDER_KIND_LABEL[order.kind] ?? order.kind}
              </div>
              <div className="tnum truncate text-micro text-ink-3 sm:hidden">
                触发 {price(order.stop_price ?? order.activate_price)}
                {order.close_position && ' · 全平仓位'}
                {!order.close_position && order.reduce_only && ' · 只减仓'}
              </div>
            </div>
            <div className="hidden min-w-0 sm:block">
              <div className="tnum truncate text-sm text-ink">
                {price(order.stop_price ?? order.activate_price)}
              </div>
              <div className="truncate text-micro text-ink-3">
                {order.trigger_by === 'mark' ? '标记价' : order.trigger_by === 'last' ? '最新价' : '—'}
              </div>
            </div>
            <div className="hidden min-w-0 sm:block">
              {/* 现货没有"减仓/平仓"这回事，落到这一列的是委托数量本身 */}
              <div className="truncate text-sm text-ink-2">
                {order.close_position ? '全平仓位'
                  : order.reduce_only ? '只减仓'
                    : order.venue === 'spot' ? amount(order.orig_qty)
                      : '新开仓'}
              </div>
              <div className="tnum truncate text-micro text-ink-3">
                {order.callback_rate !== null ? `回调 ${percent(order.callback_rate, 1)}`
                  : order.kind === 'stop' || order.kind === 'take_profit'
                    ? `限价 ${price(order.price)}`
                    : amount(order.orig_qty)}
              </div>
            </div>
            <Gap label="距触发" order={order} />
          </li>
        ))}
      </ul>
    </>
  )
}

const STATUS_TONE: Record<string, string> = {
  filled: 'text-ink',
  partially_filled: 'text-accent',
  canceled: 'text-ink-3',
  expired: 'text-ink-3',
  rejected: 'text-loss',
  new: 'text-ink-2',
}

const HISTORY_ROW = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]'

export function HistoryTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <Empty>这段区间里没有委托记录。</Empty>
  return (
    <>
      <div className={cn(HISTORY_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>时间</span>
        <span className="hidden sm:block">方向</span>
        <span className="hidden sm:block">委托价</span>
        <span className="hidden sm:block">数量</span>
        <span className="text-right sm:text-left">状态</span>
      </div>
      <ul className="divide-y divide-rule">
        {orders.map((order) => (
          <li className={cn(HISTORY_ROW, 'py-3 transition-colors duration-200 hover:bg-sheet-2/45')} key={order.id}>
            <div className="min-w-0">
              <div className="tnum truncate text-sm text-ink-2">{order.created_at.slice(5, 16).replace('T', ' ')}</div>
              <div className="truncate text-micro text-ink-3">{relativeTime(order.created_at)}</div>
            </div>
            <div className="hidden sm:block"><SideKind order={order} /></div>
            <div className="tnum hidden truncate text-sm text-ink sm:block">
              {order.price === null ? <span className="text-ink-3">市价</span> : price(order.price)}
            </div>
            <div className="hidden sm:block"><Filled order={order} /></div>
            <div className={cn('truncate text-right text-sm sm:text-left', STATUS_TONE[order.status] ?? 'text-ink-2')}>
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

const FILL_ROW = 'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'

export function FillTable({ fills }: { fills: Fill[] }) {
  if (fills.length === 0) return <Empty>这段区间里没有成交。</Empty>
  return (
    <>
      <div className={cn(FILL_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>时间</span>
        <span className="hidden sm:block">方向</span>
        <span className="hidden sm:block">成交价</span>
        <span className="hidden sm:block">数量</span>
        <span className="text-right sm:text-left">成交额</span>
        <span className="hidden sm:block">手续费</span>
        <span className="hidden sm:block">已实现</span>
      </div>
      <ul className="divide-y divide-rule">
        {fills.map((fill) => (
          <li className={cn(FILL_ROW, 'py-3 transition-colors duration-200 hover:bg-sheet-2/45')} key={fill.id}>
            <div className="tnum min-w-0 truncate text-sm text-ink-2">
              {fill.time.slice(5, 16).replace('T', ' ')}
            </div>
            <div className="hidden min-w-0 sm:block">
              <div className="text-sm text-ink">{fill.side === 'buy' ? '买入' : '卖出'}</div>
              <div className="text-micro text-ink-3">{fill.is_maker ? '挂单' : '吃单'}</div>
            </div>
            <div className="tnum hidden truncate text-sm text-ink sm:block">{price(fill.price)}</div>
            <div className="tnum hidden truncate text-sm text-ink-2 sm:block">{amount(fill.qty)}</div>
            <div className="tnum truncate text-right text-sm text-ink-2 sm:text-left">{money(fill.quote_qty)}</div>
            <div className="tnum hidden truncate text-sm text-loss sm:block">
              −{money(fill.commission).slice(1)} <span className="text-micro text-ink-3">{fill.commission_asset}</span>
            </div>
            <div className={cn('tnum hidden truncate text-sm sm:block',
              fill.realized_pnl === null || fill.realized_pnl === 0 ? 'text-ink-3'
                : fill.realized_pnl > 0 ? 'text-gain' : 'text-loss')}>
              {fill.realized_pnl === null || fill.realized_pnl === 0 ? '—' : signedMoney(fill.realized_pnl)}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
