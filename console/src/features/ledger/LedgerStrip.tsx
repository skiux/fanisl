import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { LedgerSnapshot } from '../../api/types'
import { countsToNet } from './Timeline'

/**
 * 常驻摘要条。这一页独有的一格是"取数成本"——八个来源合并，划转还要按 type
 * 枚举几十次，刷一次的权重开销在 IP 限额（6000/分钟）面前不是可以忽略的数。
 * 界面该把这件事说出来，而不是让人点了刷新才发现要等。
 */
export function LedgerStrip({ snapshot, veiled }: { snapshot: LedgerSnapshot; veiled: boolean }) {
  const live = snapshot.sources.filter((source) => source.status === 'ok')
  const missing = snapshot.sources.length - live.length
  const blind = live.length === 0
  const net = snapshot.entries.filter(countsToNet)
    .reduce((sum, entry) => sum + (entry.value_usd ?? 0), 0)

  const used = snapshot.windows.filter((row) => (
    snapshot.sources.find((source) => source.key === row.key)?.status === 'ok'
  ))
  const weight = used.reduce((sum, row) => sum + row.weight * row.calls, 0)
  const calls = used.reduce((sum, row) => sum + row.calls, 0)

  const cells = [
    {
      label: '区间',
      value: `${snapshot.window.from.slice(5, 10)} → ${snapshot.window.to.slice(5, 10)}`,
      note: `${snapshot.window.days} 天`,
      muted: false,
    },
    {
      label: '来源',
      value: `${live.length} / ${snapshot.sources.length}`,
      note: '没有统一接口，合并而来',
      muted: blind,
    },
    {
      label: '取数成本',
      value: blind ? '—' : `w ${weight.toLocaleString('en-US')}`,
      note: blind ? '取不到' : `${calls} 次调用`,
      muted: blind,
    },
  ]

  return (
    <div className={cn('flex flex-wrap items-end gap-x-14 gap-y-5 px-5 pb-4 pt-4 sm:px-10 sm:pb-5 sm:pt-5', veiled && 'veiled')}>
      <div>
        <span className="label">本期净额</span>
        <div className={cn(
          'tnum mt-2 text-[2rem] font-medium leading-none tracking-[-0.03em] sm:text-[2.5rem]',
          blind ? 'text-ink-3' : net >= 0 ? 'text-gain' : 'text-loss',
        )}>
          {blind ? '—' : signedMoney(net)}
        </div>
        <div className={cn('mt-1.5 text-xs', missing > 0 ? 'text-loss' : 'text-ink-3')}>
          {missing > 0
            ? `不完整 · ${missing} 个来源取不到`
            : '进出与收支合计 · 不含内部搬运'}
        </div>
      </div>

      {cells.map((cell) => (
        <div className="pb-1" key={cell.label}>
          <span className="label">{cell.label}</span>
          <div className={cn('tnum mt-1.5 text-lg leading-none', cell.muted ? 'text-ink-3' : 'text-ink')}>
            {cell.value}
          </div>
          <div className="mt-1 text-xs text-ink-3">{cell.note}</div>
        </div>
      ))}
    </div>
  )
}
