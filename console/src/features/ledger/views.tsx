import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { LEDGER_KIND_LABEL, money, signedMoney, SOURCE_LABEL } from '../../lib/format'
import type {
  LedgerEntry, LedgerGroup, LedgerSnapshot, SourceKey,
} from '../../api/types'
import { Timeline } from './Timeline'

export type LedgerFilter = 'all' | LedgerGroup

export const FILTER_LABEL: Record<LedgerFilter, string> = {
  all: '全部', external: '进出', income: '收支', internal: '内部',
}

export function filterEntries(entries: LedgerEntry[], filter: LedgerFilter) {
  return filter === 'all' ? entries : entries.filter((entry) => entry.group === filter)
}

/** 每一类固定由哪几个接口供数。与本次取到几条无关 */
const GROUP_SOURCES: Record<LedgerGroup, Set<SourceKey>> = {
  external: new Set(['deposits', 'withdrawals']),
  income: new Set(['income', 'earn_rewards', 'margin_interest']),
  internal: new Set(['wallet_transfers', 'convert', 'dust']),
}

const sumUsd = (rows: LedgerEntry[]) => rows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
const byKind = (rows: LedgerEntry[], kind: LedgerEntry['kind']) =>
  rows.filter((row) => row.kind === kind)

/** 各筛选下该看的四个数不一样，硬套同一组只会有一半是废格子 */
function summaryOf(all: LedgerEntry[], rows: LedgerEntry[], filter: LedgerFilter) {
  const count = { label: '记录数', value: `${rows.length}` }
  switch (filter) {
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

export function LedgerView({ snapshot, veiled, filter }: {
  snapshot: LedgerSnapshot
  veiled: boolean
  filter: LedgerFilter
}) {
  const rows = filterEntries(snapshot.entries, filter)
  const summary = summaryOf(snapshot.entries, rows, filter)

  const kinds = [...new Set(rows.map((row) => row.kind))]
    .map((kind) => {
      const bucket = byKind(rows, kind)
      return { kind, count: bucket.length, usd: sumUsd(bucket), neutral: bucket[0].group === 'internal' }
    })
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))
  const scale = Math.max(...kinds.map((row) => Math.abs(row.usd)), 1)

  // 按该类**可能**用到的来源收窄，而不是按这次真取到几条——
  // 这一节回答的是"这一类为什么只能看这么久"，某个接口这次恰好没记录，
  // 不代表它的窗口限制不在。
  const windows = snapshot.windows.filter((row) => (
    filter === 'all' || GROUP_SOURCES[filter].has(row.key)
  ))
  const down = windows
    .filter((row) => snapshot.sources.find((source) => source.key === row.key)?.status !== 'ok')
    .map((row) => row.key)

  if (down.length === windows.length && windows.length > 0) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module span="lg:col-span-7" title="流水取不到">
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

          <Module note={`${kinds.length} 类`} span="" title="按类型">
            {kinds.length > 0 ? (
              <ul className="space-y-px">
                {kinds.map((row) => {
                  const ratio = Math.min(1, Math.abs(row.usd) / scale)
                  const positive = row.usd >= 0
                  return (
                    <li className="flex items-center gap-3 border-b border-rule py-2" key={row.kind}>
                      <span className="w-[68px] shrink-0 truncate text-xs text-ink-2">
                        {LEDGER_KIND_LABEL[row.kind] ?? row.kind}
                      </span>
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
            ) : <p className="text-sm text-ink-3">这段区间里没有记录。</p>}
          </Module>
        </Stack>


      </ViewGrid>
    </div>
  )
}

