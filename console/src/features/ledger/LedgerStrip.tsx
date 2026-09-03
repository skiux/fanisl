import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { LedgerSnapshot } from '../../api/types'
import { countsToNet } from './Timeline'

/**
 * 常驻摘要条。
 *
 * 原先这里有一格"取数成本"（权重 21,373 · 48 次调用），还有每格底下一行口径说明
 * （"没有统一接口，合并而来""进出与收支合计·不含内部搬运"）。都删了：那是接口
 * 的构造，属于 `binance/README.md`，不属于看钱的页面。**只有"数据不完整"这种
 * 影响读数可信度的提示留下**——它不是解释，是警告。
 */
export function LedgerStrip({ snapshot, veiled }: { snapshot: LedgerSnapshot; veiled: boolean }) {
  const live = snapshot.sources.filter((source) => source.status === 'ok')
  const missing = snapshot.sources.length - live.length
  const blind = live.length === 0
  const net = snapshot.entries.filter(countsToNet)
    .reduce((sum, entry) => sum + (entry.value_usd ?? 0), 0)

  const cells = [
    {
      label: '区间',
      value: `${snapshot.window.from.slice(5, 10)} → ${snapshot.window.to.slice(5, 10)}`,
      note: `${snapshot.window.days} 天`,
      muted: false,
    },
    {
      label: '记录数',
      value: blind ? '—' : String(snapshot.entries.length),
      note: undefined,
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
        {/* 只在数据不完整时说话。合计口径属于文档，不属于这里 */}
        {missing > 0 && (
          <div className="mt-1.5 text-xs text-loss">不完整 · {missing} 个来源取不到</div>
        )}
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
