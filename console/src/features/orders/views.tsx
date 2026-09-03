import { Figure, Module, SplitBar, Stack, ViewGrid } from '../../components/layout'
import { useState } from 'react'
import { SegmentedControl } from '../../components/controls'
import { cn } from '../../lib/cn'
import {
  CONDITIONAL_KINDS, money, ORDER_KIND_LABEL, percent, price, relativeTime,
  baseOf, signedMoney, SOURCE_LABEL, VENUE_LABEL,
} from '../../lib/format'
import type { OrdersSnapshot, Order, OrderVenue, SourceKey } from '../../api/types'
import { NoOrdersState } from '../portfolio/states'
import { FillTable, gapOf, HistoryTable, OpenOrderTable } from './OrderTables'

export const isConditional = (order: Order) => CONDITIONAL_KINDS.has(order.kind)

const VENUES: OrderVenue[] = ['spot', 'usdm', 'margin']


const VENUE_SOURCE: Record<OrderVenue, SourceKey> = {
  spot: 'spot_open',
  usdm: 'futures_open',
  margin: 'margin_open',
}

export function OpenView({ snapshot, veiled }: { snapshot: OrdersSnapshot; veiled: boolean }) {
  // 按账户筛。三个账户的挂单原先揉在一张表里，只能靠每行的小标签分辨——
  // 而"我现在只想看合约"是这一页最常见的问题。
  const [only, setOnly] = useState<OrderVenue | null>(null)
  const shown = only === null ? snapshot.open
    : snapshot.open.filter((order) => order.venue === only)
  const rows = shown
  const notional = snapshot.open.reduce((sum, order) => sum + (order.notional_usd ?? 0), 0)
  const byVenue = VENUES.map((venue) => {
    const rows = snapshot.open.filter((order) => order.venue === venue)
    const source = snapshot.sources.find((item) => item.key === VENUE_SOURCE[venue])
    return {
      venue,
      down: source !== undefined && source.status !== 'ok',
      count: rows.length,
      notional: rows.reduce((sum, order) => sum + (order.notional_usd ?? 0), 0),
    }
  }).filter((row) => row.count > 0 || row.down)

  const ages = snapshot.open.map((order) => Date.now() - new Date(order.created_at).getTime())
    .sort((a, b) => a - b)
  const oldest = snapshot.open.reduce<Order | null>(
    (best, order) => (best === null || order.created_at < best.created_at ? order : best), null)
  const medianAge = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : null
  const freshCount = ages.filter((age) => age < 24 * 3600_000).length
  const partial = snapshot.open.filter((order) => order.executed_qty > 0).length
  // 离成交/触发最近的一笔：这一页唯一需要"判断"的地方
  const nearest = snapshot.open.reduce<{ order: Order; gap: number } | null>((best, order) => {
    const gap = gapOf(order)
    if (gap === null) return best
    return best === null || Math.abs(gap) < Math.abs(best.gap) ? { order, gap } : best
  }, null)

  const downVenues = byVenue.filter((row) => row.down)
  const allDown = byVenue.length > 0 && downVenues.length === byVenue.length

  // 真的一笔都没有，就给一句话，而不是四个模块各说一遍"没有"
  if (snapshot.open.length === 0 && downVenues.length === 0) {
    return <NoOrdersState />
  }

  // 三个账户全取不到时，"0 笔挂单"是假话——这里不给表，只说取不到
  if (allDown) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module caliber="三个账户分别请求，这次都没回来" span="lg:col-span-7" title="挂单取不到">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              现货、合约与杠杆的挂单各走一个接口，本次一个都没取到。
              这里不写「0 笔」——取不到和没有挂单是两回事。
            </p>
            <ul className="mt-5 divide-y divide-rule border-t border-rule">
              {snapshot.sources.filter((source) => source.status !== 'ok').map((source) => (
                <li className="flex items-center gap-3 py-2.5" key={source.key}>
                  <span className="w-[84px] shrink-0 text-xs text-ink-2">
                    {SOURCE_LABEL[source.key] ?? source.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{source.detail ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Module>
          <VenueBreakdown notional={notional} rows={byVenue} span="lg:col-span-5" />
        </ViewGrid>
      </div>
    )
  }

  return (
    <div className={cn(veiled && 'veiled')}>
      {/* 一张表。每一条已经写着自己是限价还是条件了，按类型切块或者加类型筛选
          都是把同一件事说两遍——屏幕上已经有的信息不该再做一遍筛选器。
          账户不一样：那是行里的小标签，扫十条也看不出"合约一共几笔"。 */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <SegmentedControl
          items={[
            { value: 'all', label: '全部', badge: snapshot.open.length },
            ...byVenue.map((row) => ({
              value: row.venue, label: VENUE_LABEL[row.venue] ?? row.venue,
              badge: row.down ? '—' : row.count, muted: row.down,
            })),
          ]}
          label="账户"
          onValueChange={(next) => setOnly(next === 'all' ? null : next as OrderVenue)}
          size="sm"
          value={only ?? 'all'}
        />
      </div>
      <ViewGrid>
        <Module
          figure={money(rows.reduce((sum, order) => sum + (order.notional_usd ?? 0), 0))}
          note={downVenues.length > 0 ? '不含取不到的账户' : '名义合计'}
          span="lg:col-span-12"
          title="挂单"
        >
          <OpenOrderTable orders={rows} />
        </Module>

        <VenueBreakdown notional={notional} rows={byVenue} span="lg:col-span-4" />

        <Module
          note={nearest ? `离成交最近的是 ${baseOf(nearest.order.symbol)}` : '没有可比对的报价'}
          span="lg:col-span-4"
          title="挂了多久"
        >
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Figure
              label="最早一笔"
              note={oldest ? baseOf(oldest.symbol) : undefined}
              value={oldest ? relativeTime(oldest.created_at) : '—'}
            />
            <Figure
              label="挂单时长中位"
              value={medianAge === null ? '—' : `${Math.round(medianAge / 3600_000)} 小时`}
            />
            <Figure label="24 小时内新挂" value={String(freshCount)} />
            <Figure label="已部分成交" caliber="仓位已占用" value={String(partial)} />
          </dl>
        </Module>

        {snapshot.order_lists.length > 0 && (
          <Module caliber="一条成交，另一条自动撤销" span="lg:col-span-4" title="OCO 组">
            <ul className="space-y-4">
              {snapshot.order_lists.map((group) => {
                const legs = snapshot.open.filter((order) => order.order_list_id === group.id)
                return (
                  <li key={group.id}>
                    <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
                      <span className="text-sm text-ink">{baseOf(group.symbol)}</span>
                      <span className="text-xs text-ink-3">{group.contingency} · {legs.length} 条</span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {legs.map((leg) => (
                        <li className="flex items-baseline justify-between gap-3" key={leg.id}>
                          <span className="text-xs text-ink-3">{ORDER_KIND_LABEL[leg.kind] ?? leg.kind}</span>
                          <span className="tnum text-xs text-ink-2">{price(leg.stop_price ?? leg.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </Module>
        )}
      </ViewGrid>
    </div>
  )
}

type VenueRow = { venue: OrderVenue; down: boolean; count: number; notional: number }

function VenueBreakdown({ rows, notional, span }: {
  rows: VenueRow[]
  notional: number
  span: string
}) {
  return (
    <Module caliber="未成交量 × 委托价" span={span} title="按账户">
      {rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li className="flex items-center gap-3" key={row.venue}>
              <span className="w-[56px] shrink-0 text-xs text-ink-2">{VENUE_LABEL[row.venue]}</span>
              <span className="h-[3px] w-[84px] shrink-0 overflow-hidden rounded-full bg-rule">
                <span
                  className="block h-full rounded-full bg-ink-3 transition-[width] duration-500"
                  style={{ width: `${!row.down && notional > 0 ? ((row.notional / notional) * 100).toFixed(1) : 0}%` }}
                />
              </span>
              {row.down ? (
                <span className="ml-auto whitespace-nowrap text-xs text-loss">取不到</span>
              ) : (
                <>
                  <span className="tnum ml-auto whitespace-nowrap text-sm text-ink">{money(row.notional)}</span>
                  {/* 同「充提」：去掉"笔"之后这里剩个裸数字，用 ×n 表示条数 */}
                  <span className="tnum w-[34px] shrink-0 text-right text-xs text-ink-3">×{row.count}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-3">当前没有挂单。</p>}
    </Module>
  )
}

export function HistoryView({ snapshot, veiled, symbol, onSelectSymbol }: {
  snapshot: OrdersSnapshot
  veiled: boolean
  symbol: string
  onSelectSymbol: (next: string) => void
}) {
  const q = snapshot.query
  const down = snapshot.sources.filter((source) => (
    (source.key === 'order_history' || source.key === 'trade_history') && source.status !== 'ok'
  ))
  const picker = (
    <QueryPanel
      onSelectSymbol={onSelectSymbol}
      query={q}
      span="lg:col-span-5"
      symbol={symbol}
      symbols={snapshot.history_symbols}
    />
  )

  if (down.length > 0) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module caliber="委托与成交同源" span="lg:col-span-7" title="历史查询不可用">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              历史委托与成交明细都要按交易对逐次查询，这次的请求没有回来。
              交易对可以照常切换，但在接口恢复前这里不会有记录——空着，不拿别的区间顶替。
            </p>
            <ul className="mt-5 divide-y divide-rule border-t border-rule">
              {down.map((source) => (
                <li className="flex items-center gap-3 py-2.5" key={source.key}>
                  <span className="w-[84px] shrink-0 text-xs text-ink-2">
                    {SOURCE_LABEL[source.key] ?? source.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{source.detail ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Module>
          {picker}
        </ViewGrid>
      </div>
    )
  }

  const fills = snapshot.fills
  const traded = fills.reduce((sum, fill) => sum + fill.quote_qty, 0)
  const fees = fills.reduce((sum, fill) => sum + fill.commission, 0)
  const makerQty = fills.filter((fill) => fill.is_maker).reduce((sum, fill) => sum + fill.quote_qty, 0)
  const realized = fills.reduce((sum, fill) => sum + (fill.realized_pnl ?? 0), 0)

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={String(snapshot.history.length)}
          note={q ? `${baseOf(q.symbol)} · ${VENUE_LABEL[q.venue]}` : '未选定交易对'}
          span="lg:col-span-7"
          title="委托历史"
        >
          <HistoryTable orders={snapshot.history} />
        </Module>

        <Stack span="lg:col-span-5">
          <QueryPanel
            onSelectSymbol={onSelectSymbol}
            query={q}
            span=""
            symbol={symbol}
            symbols={snapshot.history_symbols}
          />

          <Module
            figure={fills.length > 0 ? signedMoney(realized) : '—'}
            caliber="区间内已实现"
            span=""
            title="成交小结"
            tone={fills.length === 0 ? 'muted' : realized >= 0 ? 'gain' : 'loss'}
          >
            {fills.length > 0 ? (
              <>
                <SplitBar
                  left={makerQty}
                  leftLabel="挂单成交"
                  right={traded - makerQty}
                  rightLabel="吃单成交"
                />
                <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <Figure label="成交笔数" value={String(fills.length)} />
                  <Figure label="成交额" value={money(traded)} />
                  <Figure label="手续费" tone="loss" value={signedMoney(-fees)} />
                  <Figure
                    label="费率"
                    caliber="占成交额"
                    value={traded > 0 ? percent(fees / traded, 3) : '—'}
                  />
                </dl>
              </>
            ) : <p className="text-sm text-ink-3">这段区间里没有成交。</p>}
          </Module>
        </Stack>

        <Module
          figure={money(traded)}
          note="成交额"
          span="lg:col-span-12"
          title="成交明细"
        >
          <FillTable fills={fills} />
        </Module>
      </ViewGrid>
    </div>
  )
}

/**
 * 查询条件本身就是这一页的内容。allOrders / myTrades 都必须传 symbol，
 * 单次区间还有上限——把这几条摆在明面上，好过让人以为这里是一条能一直翻的全量流水。
 */
function QueryPanel({ symbol, symbols, query, span, onSelectSymbol }: {
  symbol: string
  symbols: string[]
  query: OrdersSnapshot['query']
  span: string
  onSelectSymbol: (next: string) => void
}) {
  return (
    <Module caliber="接口只允许按交易对查" span={span} title="查询范围">
      <label className="flex items-center gap-3">
        <span className="w-[56px] shrink-0 text-xs text-ink-2">交易对</span>
        <select
          className="min-w-0 flex-1 cursor-pointer rounded-[var(--radius-control)] border border-rule bg-transparent px-2 py-1.5 text-sm text-ink outline-none transition-colors hover:border-rule-strong focus-visible:border-accent disabled:opacity-40"
          disabled={symbols.length === 0}
          onChange={(event) => onSelectSymbol(event.target.value)}
          value={symbol}
        >
          {symbols.map((item) => (
            <option className="bg-sheet text-ink" key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <dl className="mt-4 space-y-2.5 border-t border-rule pt-4">
        {([
          ['区间', query ? `${query.from.slice(5, 10)} → ${query.to.slice(5, 10)}` : '—'],
          ['单次上限', query ? `${query.max_window_hours} 小时` : '—'],
          ['可回溯', query?.lookback_days ? `${query.lookback_days} 天` : '接口未声明'],
        ] as const).map(([label, value]) => (
          <div className="flex items-baseline justify-between gap-4" key={label}>
            <span className="text-xs text-ink-3">{label}</span>
            <span className="tnum text-sm text-ink-2">{value}</span>
          </div>
        ))}
      </dl>
    </Module>
  )
}
