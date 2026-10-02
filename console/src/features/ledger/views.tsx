import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { baseOf, LEDGER_KIND_LABEL, money, signedMoney, SOURCE_LABEL } from '../../lib/format'
import type {
  LedgerEntry, LedgerGroup, LedgerSnapshot, SourceKey,
} from '../../api/types'
import { Timeline } from './Timeline'

/**
 * 「成本」不是后端的分组，是从收支里挑出来的那几类：持仓本身要付的钱。
 * 已实现盈亏是交易结果、保险清算是强平的事，都不算；返佣是手续费的折让，算进来抵扣。
 */
export type LedgerFilter = 'all' | LedgerGroup | 'cost'

export const FILTER_LABEL: Record<LedgerFilter, string> = {
  all: '全部', external: '进出', income: '收支', internal: '内部', cost: '成本',
}

export const COST_KINDS: ReadonlySet<LedgerEntry['kind']> = new Set([
  'funding_fee', 'commission', 'referral_kickback', 'margin_interest',
])

export const isCost = (entry: LedgerEntry) => COST_KINDS.has(entry.kind)

export function filterEntries(entries: LedgerEntry[], filter: LedgerFilter) {
  if (filter === 'all') return entries
  if (filter === 'cost') return entries.filter(isCost)
  return entries.filter((entry) => entry.group === filter)
}

/** 每一类固定由哪几个接口供数。与本次取到几条无关 */
const GROUP_SOURCES: Record<Exclude<LedgerFilter, 'all'>, Set<SourceKey>> = {
  external: new Set(['deposits', 'withdrawals']),
  income: new Set(['income', 'margin_interest']),
  internal: new Set(['wallet_transfers', 'convert', 'dust']),
  cost: new Set(['income', 'margin_interest']),
}

const sumUsd = (rows: LedgerEntry[]) => rows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
const byKind = (rows: LedgerEntry[], kind: LedgerEntry['kind']) =>
  rows.filter((row) => row.kind === kind)

const toneOf = (usd: number) => (usd >= 0 ? 'gain' as const : 'loss' as const)

/** 各筛选下该看的四个数不一样，硬套同一组只会有一半是废格子 */
function summaryOf(all: LedgerEntry[], rows: LedgerEntry[], filter: LedgerFilter, days: number) {
  const count = { label: '记录数', value: `${rows.length}` }
  switch (filter) {
    case 'cost': {
      // 先给合计与日均（这段时间一共花了多少、折到每天多少），再拆四类。
      // 资金费是净额：空头会收到资金费，那一部分在这里直接抵掉
      const total = sumUsd(rows)
      const part = (kind: LedgerEntry['kind'], label: string) => {
        const bucket = byKind(rows, kind)
        return { label, value: signedMoney(sumUsd(bucket)), note: `${bucket.length}`, tone: toneOf(sumUsd(bucket)) }
      }
      return [
        { label: '合计', value: signedMoney(total), tone: toneOf(total) },
        { label: '日均', value: signedMoney(total / Math.max(days, 1)), tone: toneOf(total) },
        part('funding_fee', '资金费'),
        part('commission', '手续费'),
        part('referral_kickback', '返佣'),
        part('margin_interest', '杠杆利息'),
      ]
    }
    case 'external':
      return [
        { label: '充值', value: money(sumUsd(byKind(rows, 'deposit'))), note: `${byKind(rows, 'deposit').length}` },
        { label: '提现', value: money(Math.abs(sumUsd(byKind(rows, 'withdraw')))), note: `${byKind(rows, 'withdraw').length}` },
        { label: '净流入', value: signedMoney(sumUsd(rows)), tone: sumUsd(rows) >= 0 ? 'gain' as const : 'loss' as const },
        count,
      ]
    case 'income': {
      const gain = rows.filter((row) => (row.value_usd ?? 0) > 0)
      const cost = rows.filter((row) => (row.value_usd ?? 0) < 0)
      return [
        { label: '收入', value: signedMoney(sumUsd(gain)), tone: 'gain' as const },
        { label: '支出', value: signedMoney(sumUsd(cost)), tone: 'loss' as const },
        { label: '净额', value: signedMoney(sumUsd(rows)), tone: sumUsd(rows) >= 0 ? 'gain' as const : 'loss' as const },
        count,
      ]
    }
    case 'internal':
      return [
        { label: '钱包划转', value: money(Math.abs(sumUsd(byKind(rows, 'transfer')))), note: `${byKind(rows, 'transfer').length}` },
        { label: '闪兑', value: money(Math.abs(sumUsd(byKind(rows, 'convert')))), note: `${byKind(rows, 'convert').length}` },
        { label: '小额兑换', value: money(Math.abs(sumUsd(byKind(rows, 'dust')))), note: `${byKind(rows, 'dust').length}` },
        count,
      ]
    default: {
      const external = all.filter((row) => row.group === 'external')
      const income = all.filter((row) => row.group === 'income')
      const internal = all.filter((row) => row.group === 'internal')
      return [
        { label: '外部净流入', value: signedMoney(sumUsd(external)) },
        { label: '收支净额', value: signedMoney(sumUsd(income)), tone: sumUsd(income) >= 0 ? 'gain' as const : 'loss' as const },
        { label: '内部搬运', value: money(Math.abs(sumUsd(internal))) },
        count,
      ]
    }
  }
}

type BarRow = { key: string; label: string; usd: number; count: number; neutral: boolean; title?: string }

/** 最多列几行。再多就是一份长清单，合并成"其余 N 项"一行，免得右栏要往下滚 */
const BAR_LIMIT = 8

/**
 * 成本按标的拆：资金费与手续费跟着交易对走，杠杆利息按借的币，返佣是账户级的单列一行。
 * 回答的是"哪个仓位最费钱"——资金费拆到标的上才看得出是哪一笔在持续付钱。
 */
export function costBySymbol(rows: LedgerEntry[]): BarRow[] {
  const buckets = new Map<string, BarRow & { funding: number; commission: number }>()
  for (const row of rows.filter(isCost)) {
    const key = row.kind === 'margin_interest' ? `interest:${row.asset}`
      : row.kind === 'referral_kickback' ? 'kickback'
        : `symbol:${row.symbol ?? row.asset}`
    const label = row.kind === 'margin_interest' ? `利息 · ${row.asset}`
      : row.kind === 'referral_kickback' ? '返佣'
        : row.symbol ? baseOf(row.symbol) : row.asset
    const bucket = buckets.get(key) ?? { key, label, usd: 0, count: 0, neutral: false, funding: 0, commission: 0 }
    const usd = row.value_usd ?? 0
    bucket.usd += usd
    bucket.count += 1
    if (row.kind === 'funding_fee') bucket.funding += usd
    if (row.kind === 'commission') bucket.commission += usd
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .map(({ funding, commission, ...row }) => ({
      ...row,
      title: row.key.startsWith('symbol:')
        ? `资金费 ${signedMoney(funding)} · 手续费 ${signedMoney(commission)}` : undefined,
    }))
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
}

/**
 * 超过上限的尾部并成一行。只给同一种量的清单用（成本按标的，全是带符号的花费）；
 * 按类型那张里混着"搬了多少"的内部划转，加在一起没有意义，所以不截。
 */
function limitRows(rows: BarRow[]): BarRow[] {
  if (rows.length <= BAR_LIMIT) return rows
  const rest = rows.slice(BAR_LIMIT - 1)
  return [...rows.slice(0, BAR_LIMIT - 1), {
    key: 'rest', label: `其余 ${rest.length} 项`, neutral: false,
    usd: rest.reduce((sum, row) => sum + row.usd, 0),
    count: rest.reduce((sum, row) => sum + row.count, 0),
  }]
}

function BarList({ rows, limit = false }: { rows: BarRow[]; limit?: boolean }) {
  const scale = Math.max(...rows.map((row) => Math.abs(row.usd)), 1)
  return (
    <ul className="space-y-px">
      {(limit ? limitRows(rows) : rows).map((row) => {
        const ratio = Math.min(1, Math.abs(row.usd) / scale)
        const positive = row.usd >= 0
        return (
          <li className="flex items-center gap-3 border-b border-rule py-2" key={row.key} title={row.title}>
            <span className="w-[68px] shrink-0 truncate text-xs text-ink-2">{row.label}</span>
            <span aria-hidden="true" className="relative block h-[9px] w-[72px] shrink-0">
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-rule-strong" />
              <span
                className={cn('absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]',
                  row.neutral ? 'bg-ink-3/70' : positive ? 'bg-gain/70' : 'bg-loss/70')}
                style={positive
                  ? { left: '50%', width: `${Math.max(ratio * 50, 1.6).toFixed(2)}%` }
                  : { right: '50%', width: `${Math.max(ratio * 50, 1.6).toFixed(2)}%` }}
              />
            </span>
            <span className={cn('tnum ml-auto whitespace-nowrap text-xs',
              row.neutral ? 'text-ink-2' : positive ? 'text-gain' : 'text-loss')}>
              {row.neutral ? money(Math.abs(row.usd)) : signedMoney(row.usd)}
            </span>
            <span className="tnum w-[30px] shrink-0 text-right text-micro text-ink-3">{row.count}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function LedgerView({ snapshot, veiled, filter }: {
  snapshot: LedgerSnapshot
  veiled: boolean
  filter: LedgerFilter
}) {
  const rows = filterEntries(snapshot.entries, filter)
  const summary = summaryOf(snapshot.entries, rows, filter, snapshot.window.days)

  // 成本那一页按标的拆（四类本身已经在合计里列着了）；其余按类型
  const bars: BarRow[] = filter === 'cost' ? costBySymbol(rows)
    : [...new Set(rows.map((row) => row.kind))]
      .map((kind) => {
        const bucket = byKind(rows, kind)
        return {
          key: kind, label: LEDGER_KIND_LABEL[kind] ?? kind,
          count: bucket.length, usd: sumUsd(bucket), neutral: bucket[0].group === 'internal',
        }
      })
      .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))

  // 这一类用到的来源里，哪些这次没取到——合计不完整时要跟着数字一起说。
  // 原先是从 `snapshot.windows`（端点清单）里筛的，那份数据只为「取数窗口」
  // 那张表存在；表删了之后，直接从 sources 算就够，不必让接口再驮着它。
  const down = snapshot.sources
    .filter((source) => source.status !== 'ok'
      && (filter === 'all' || GROUP_SOURCES[filter].has(source.key)))
    .map((source) => source.key)

  // 这一类的来源全挂了才说"取不到"——只挂一两个时数字仍然有意义，
  // 上面那句"缺 X"会跟着合计一起出现
  const relevant = snapshot.sources.filter((source) =>
    filter === 'all' || GROUP_SOURCES[filter].has(source.key))
  if (relevant.length > 0 && down.length === relevant.length) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module span="lg:col-span-7" title="流水未取到">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              这一页没有单一的数据源，时间线是下面这些端点各拉一段拼出来的。
              相关的几个这次都没返回，所以这里既不给记录也不给合计——
              合计写成 0 会读成"这段时间什么都没发生"，那不是同一件事。
            </p>
            <ul className="mt-5 divide-y divide-rule border-t border-rule">
              {down.map((key) => {
                const source = snapshot.sources.find((item) => item.key === key)
                return (
                  <li className="flex items-center gap-3 py-2.5" key={key}>
                    <span className="w-[84px] shrink-0 text-xs text-ink-2">{SOURCE_LABEL[key] ?? key}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{source?.detail ?? '—'}</span>
                  </li>
                )
              })}
            </ul>
          </Module>
        </ViewGrid>
      </div>
    )
  }

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          note={`${snapshot.window.days} 天 · ${rows.length}`}
          span="lg:col-span-8"
          title="流水"
        >
          {/*
            记录列表自己滚：整页跟着几百条记录一起长，摘要就被推到看不见的地方去了。
            用 max-h 而不是 h——筛到只剩一两条时，不该留一个 500px 的空滚动框。
          */}
          <div className="scroll-y max-h-[clamp(320px,46vh,520px)]">
            <Timeline entries={rows} />
          </div>
        </Module>

        <Stack span="lg:col-span-4">
          {/* 有来源挂掉时合计必然不完整，这句话得跟着数字一起出现，不能只在页脚 */}
          <Module
            note={down.length === 0 ? undefined
              : down.length <= 2
                ? `缺 ${down.map((key) => SOURCE_LABEL[key] ?? key).join('、')}`
                : `缺 ${down.length} 个来源`}
            span=""
            title="本期合计"
            tone={down.length > 0 ? 'muted' : undefined}
          >
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              {summary.map((cell) => (
                <Figure key={cell.label} label={cell.label} note={'note' in cell ? cell.note : undefined}
                  tone={'tone' in cell ? cell.tone : undefined} value={cell.value} />
              ))}
            </dl>
          </Module>

          <Module
            note={filter === 'cost' ? `${bars.length} 项` : `${bars.length} 类`}
            span=""
            title={filter === 'cost' ? '按标的' : '按类型'}
          >
            {bars.length > 0
              ? <BarList limit={filter === 'cost'} rows={bars} />
              : <p className="text-sm text-ink-3">该区间没有记录。</p>}
          </Module>
        </Stack>


      </ViewGrid>
    </div>
  )
}
