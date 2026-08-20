import { cn } from '../../lib/cn'
import { money, percent } from '../../lib/format'
import type { OrdersSnapshot, SourceKey } from '../../api/types'

const ORDER_VENUE_SOURCES: SourceKey[] = ['spot_open', 'futures_open', 'margin_open']
import { gapOf } from './OrderTables'
import { isConditional } from './views'

/**
 * 常驻摘要条。与资产页同一个位置、同一套字号——两页应当像同一份文件的两章，
 * 而不是两个各自为政的页面。
 */
export function OrdersStrip({ snapshot, veiled }: { snapshot: OrdersSnapshot; veiled: boolean }) {
  const open = snapshot.open
  // 三个挂单接口全挂时，"0 笔 / $0.00" 是假话——摘要条一律留空
  const blind = ORDER_VENUE_SOURCES.every((key) => (
    snapshot.sources.find((source) => source.key === key)?.status !== 'ok'
  ))
  const notional = open.reduce((sum, order) => sum + (order.notional_usd ?? 0), 0)
  const conditionals = open.filter(isConditional).length
  const nearest = open.reduce<number | null>((best, order) => {
    const gap = gapOf(order)
    if (gap === null) return best
    return best === null || Math.abs(gap) < Math.abs(best) ? gap : best
  }, null)

  const cells = [
    { label: '名义合计', value: blind ? '—' : money(notional), note: blind ? '取不到' : '未成交部分', muted: blind },
    { label: '条件单', value: blind ? '—' : `${conditionals} 笔`, note: blind ? '取不到' : '触发后才下单', muted: blind },
    {
      label: '离成交最近',
      value: nearest === null ? '—' : percent(Math.abs(nearest), 1),
      note: blind ? '取不到' : nearest === null ? '无报价' : Math.abs(nearest) < 0.03 ? '很近' : '还有距离',
      muted: nearest === null,
    },
  ]

  return (
    <div className={cn('flex flex-wrap items-end gap-x-14 gap-y-5 px-5 pb-4 pt-4 sm:px-10 sm:pb-5 sm:pt-5', veiled && 'veiled')}>
      <div>
        <span className="label">当前挂单</span>
        <div className={cn('tnum mt-2 text-[2rem] font-medium leading-none tracking-[-0.03em] sm:text-[2.5rem]', blind ? 'text-ink-3' : 'text-ink')}>
          {blind ? '—' : open.length}
          {!blind && <span className="ml-2 text-lg text-ink-3">笔</span>}
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
