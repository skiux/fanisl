import { useMemo, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import {
  amount, clockTime, LEDGER_KIND_LABEL, money, signedMoney, SOURCE_LABEL, WALLET_LABEL,
} from '../../lib/format'
import type { LedgerEntry } from '../../api/types'

/** 只有真正改变净值的两类计入当日净额；划转与换手是搬运，不是收支 */
export const countsToNet = (entry: LedgerEntry) =>
  entry.group === 'external' || entry.group === 'income'

type Bucket = {
  key: string
  kind: LedgerEntry['kind']
  entries: LedgerEntry[]
  usd: number
}

type Day = {
  date: string
  buckets: Bucket[]
  net: number
  /** 当天有几条真的改变净值。全是划转换手的日子不该在这一栏印一个 $0.00 */
  netCount: number
  count: number
}

/**
 * 按天分组，天内同类再收成一行。一个跑着三个永续的账户，光资金费一天就是
 * 九条结算记录，30 天四百多条——平铺出来谁也读不下去。收起来不是删：
 * 笔数和合计都在行上，点开就是逐条原始记录。
 */
function groupByDay(entries: LedgerEntry[]): Day[] {
  const days = new Map<string, Map<string, Bucket>>()
  for (const entry of entries) {
    const date = entry.time.slice(0, 10)
    if (!days.has(date)) days.set(date, new Map())
    const buckets = days.get(date)!
    if (!buckets.has(entry.kind)) {
      buckets.set(entry.kind, { key: `${date}:${entry.kind}`, kind: entry.kind, entries: [], usd: 0 })
    }
    const bucket = buckets.get(entry.kind)!
    bucket.entries.push(entry)
    bucket.usd += entry.value_usd ?? 0
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, buckets]) => {
      const rows = [...buckets.values()]
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
      const netRows = rows.flatMap((bucket) => bucket.entries.filter(countsToNet))
      return {
        date,
        buckets: rows,
        net: netRows.reduce((sum, entry) => sum + (entry.value_usd ?? 0), 0),
        netCount: netRows.length,
        count: rows.reduce((sum, bucket) => sum + bucket.entries.length, 0),
      }
    })
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function Amount({ entry }: { entry: LedgerEntry }) {
  // 划转与换手不是收支，不染绿红——颜色在这个界面里只表示盈亏方向
  const neutral = entry.group === 'internal'
  const value = entry.value_usd
  return (
    <span className={cn('tnum whitespace-nowrap text-sm',
      neutral || value === null ? 'text-ink-2'
        : value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-ink-3')}>
      {value === null ? '—' : neutral ? money(Math.abs(value)) : signedMoney(value)}
    </span>
  )
}

/** 一条原始记录：从哪来、到哪去、链上是哪一笔 */
function Detail({ entry }: { entry: LedgerEntry }) {
  const parts: string[] = []
  if (entry.symbol) parts.push(entry.symbol)
  if (entry.counterparty) {
    parts.push(`${WALLET_LABEL[entry.wallet ?? ''] ?? entry.wallet} → ${WALLET_LABEL[entry.counterparty] ?? entry.counterparty}`)
  } else if (entry.wallet) {
    parts.push(WALLET_LABEL[entry.wallet] ?? entry.wallet)
  }
  if (entry.from_asset) {
    parts.push(entry.from_amount === null
      ? `由 ${entry.from_asset}兑得`
      : `${amount(Math.abs(entry.from_amount))} ${entry.from_asset} →`)
  }
  if (entry.network) parts.push(`${entry.network} 链`)
  if (entry.status !== 'confirmed') parts.push(entry.status === 'pending' ? '处理中' : '失败')
  return <>{parts.join(' · ')}</>
}

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]'

function EntryRow({ entry, indented }: { entry: LedgerEntry; indented?: boolean }) {
  return (
    <li className={cn(ROW, 'py-2.5', indented && 'pl-5')}>
      <div className="min-w-0">
        <div className="truncate text-sm text-ink-2">
          {indented ? clockTime(entry.time) : LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}
        </div>
        <div className="truncate text-micro text-ink-3"><Detail entry={entry} /></div>
      </div>
      <div className="tnum hidden truncate text-sm text-ink-2 sm:block">
        {amount(Math.abs(entry.amount))} <span className="text-ink-3">{entry.asset}</span>
      </div>
      <div className="hidden truncate text-micro text-ink-3 sm:block">
        {SOURCE_LABEL[entry.source] ?? entry.source}
      </div>
      <div className="text-right"><Amount entry={entry} /></div>
    </li>
  )
}

function BucketRow({ bucket }: { bucket: Bucket }) {
  const [open, setOpen] = useState(false)
  if (bucket.entries.length === 1) return <EntryRow entry={bucket.entries[0]} />

  const assets = [...new Set(bucket.entries.map((entry) => entry.asset))]
  const neutral = bucket.entries[0].group === 'internal'
  return (
    <li>
      <button
        aria-expanded={open}
        className={cn(ROW, 'w-full py-2.5 text-left transition-colors duration-200 hover:bg-sheet-2/45')}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CaretDown
            aria-hidden="true"
            className={cn('shrink-0 text-ink-3 transition-transform duration-300', open && 'rotate-180')}
            size={12}
          />
          <div className="min-w-0">
            <div className="truncate text-sm text-ink-2">
              {LEDGER_KIND_LABEL[bucket.kind] ?? bucket.kind}
            </div>
            <div className="truncate text-micro text-ink-3">{bucket.entries.length} 笔</div>
          </div>
        </div>
        <div className="tnum hidden truncate text-sm text-ink-3 sm:block">
          {assets.length === 1 ? assets[0] : `${assets.length} 个币种`}
        </div>
        <div className="hidden truncate text-micro text-ink-3 sm:block">
          {SOURCE_LABEL[bucket.entries[0].source] ?? bucket.entries[0].source}
        </div>
        <div className="text-right">
          <span className={cn('tnum whitespace-nowrap text-sm',
            neutral ? 'text-ink-2' : bucket.usd > 0 ? 'text-gain' : bucket.usd < 0 ? 'text-loss' : 'text-ink-3')}>
            {neutral ? money(Math.abs(bucket.usd)) : signedMoney(bucket.usd)}
          </span>
        </div>
      </button>
      <div className="collapsible" data-open={open}>
        <div>
          <ul className="border-l border-rule/70 pl-1">
            {bucket.entries.map((entry) => <EntryRow entry={entry} indented key={entry.id} />)}
          </ul>
        </div>
      </div>
    </li>
  )
}

export function Timeline({ entries }: { entries: LedgerEntry[] }) {
  const days = useMemo(() => groupByDay(entries), [entries])
  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">这段区间里没有记录。</p>
  }
  return (
    <div>
      {days.map((day) => (
        <section key={day.date}>
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-4 border-b border-rule bg-sheet/95 py-2 backdrop-blur">
            <div className="flex items-baseline gap-2.5">
              <span className="tnum text-sm text-ink">{day.date.slice(5)}</span>
              <span className="text-micro text-ink-3">
                {WEEKDAY[new Date(`${day.date}T00:00:00Z`).getUTCDay()]} · {day.count} 笔
              </span>
            </div>
            {day.netCount > 0 && (
              <span className={cn('tnum text-sm',
                day.net > 0 ? 'text-gain' : day.net < 0 ? 'text-loss' : 'text-ink-3')}>
                {signedMoney(day.net)}
              </span>
            )}
          </div>
          <ul className="divide-y divide-rule/60">
            {day.buckets.map((bucket) => <BucketRow bucket={bucket} key={bucket.key} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}
