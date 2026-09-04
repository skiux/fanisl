import { Strip, type StripCell } from '../../components/Strip'
import { money, percent } from '../../lib/format'
import type { OrdersSnapshot, SourceKey } from '../../api/types'

const ORDER_VENUE_SOURCES: SourceKey[] = ['spot_open', 'futures_open', 'margin_open']
import { gapOf } from './OrderTables'
import { isConditional } from './views'

/**
 * 常驻摘要条。与资产页同一个位置、同一套字号——两页应当像同一份文件的两章，
 * 而不是两个各自为政的页面。版式见 `components/Strip.tsx`。
 */
export function OrdersStrip({ snapshot, veiled }: { snapshot: OrdersSnapshot; veiled: boolean }) {
  const open = snapshot.open
  // 三个挂单接口全挂时，"0 / $0.00" 是假话——摘要条一律留空
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

  const cells: StripCell[] = [
    { label: '名义合计', value: blind ? '—' : money(notional), tone: blind ? 'muted' : undefined },
    { label: '条件单', value: blind ? '—' : String(conditionals), tone: blind ? 'muted' : undefined },
    {
      label: '离成交最近',
      value: nearest === null ? '—' : percent(Math.abs(nearest), 1),
      // 快碰到了就让这个数自己变色，不再在下面挂一行"很近"
      tone: nearest === null ? 'muted' : Math.abs(nearest) < 0.03 ? 'warn' : undefined,
    },
  ]

  return (
    <Strip
      cells={cells}
      hero={{
        label: '当前挂单',
        value: blind ? '—' : String(open.length),
        tone: blind ? 'muted' : undefined,
      }}
      veiled={veiled}
    />
  )
}
