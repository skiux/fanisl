import { useState } from 'react'
import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { DailyRealized } from '../../api/types'

/**
 * 每天落袋多少。取代原来的净值走势图。
 *
 * **为什么换掉那条线。** 它画的是日快照拼出来的净值，而 `accountSnapshot` 只有
 * 现货 / 全仓杠杆 / U 本位三种——把钱从现货挪进理财，线就往下掉一截，看着像亏了，
 * 其实一分钱没少。一条会因为划转而骗人的曲线，不如不要。
 *
 * 每日已实现只认成交与结算，划转动不了它。而且它天然是离散的日频数据，
 * 用日历比用折线诚实：折线会在两个点之间画出根本不存在的中间值。
 *
 * **为什么不是 K 线。** K 线要开高低收四个值，而"这天赚了多少"只有一个数——
 * 照 K 线画就得凭空编三个。日历格子的深浅表达的是同一件事，且没有编造。
 *
 * 触摸与鼠标走同一条路径（`pointer` 事件），所以移动端也能滑着看，
 * 不是只能点——原来那条曲线在移动端只响应点击。
 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function RealizedCalendar({ days, veiled }: {
  days: DailyRealized[]
  veiled: boolean
}) {
  const [active, setActive] = useState<DailyRealized | null>(null)

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">还没有可用的成交记录。</p>
  }

  // 色阶按当期最大绝对值归一。用绝对值而不是分别归一，是为了让"赚 500"和"亏 500"
  // 深浅一致——否则一个只小赚过的月份会和一个大亏过的月份看着一样浓。
  const peak = Math.max(...days.map((d) => Math.abs(d.realized_usd)), 1)

  // 从周一开始补齐第一列，否则第一格会落在错误的星期上
  const first = new Date(`${days[0]!.date}T00:00:00Z`)
  const lead = (first.getUTCDay() + 6) % 7
  const cells: (DailyRealized | null)[] = [...Array(lead).fill(null), ...days]

  const totals = days.reduce((sum, d) => sum + d.realized_usd, 0)
  const traded = days.filter((d) => d.traded).length
  const wins = days.filter((d) => d.realized_usd > 0).length

  return (
    <div className={cn(veiled && 'veiled')}>
      <div className="flex items-start gap-2">
        <div className="grid shrink-0 gap-[3px] pt-[13px] text-micro text-ink-3">
          {WEEKDAYS.map((day, index) => (
            // 只标一三五，七行都标会挤成一团
            <span className="h-[13px] leading-[13px]" key={day}>
              {index % 2 === 0 ? day : ''}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid grid-flow-col gap-[3px]"
            onPointerLeave={() => setActive(null)}
            style={{ gridTemplateRows: 'repeat(7, 13px)' }}
          >
            {cells.map((cell, index) => {
              if (!cell) return <span aria-hidden="true" key={`pad-${index}`} />
              const value = cell.realized_usd
              const weight = Math.abs(value) / peak
              return (
                <button
                  aria-label={`${cell.date} ${signedMoney(value)}`}
                  className={cn(
                    'size-[13px] rounded-[2px] transition-[outline-color] duration-150',
                    'outline outline-1 outline-offset-0',
                    active?.date === cell.date ? 'outline-ink' : 'outline-transparent',
                    !cell.traded && 'bg-rule',
                  )}
                  key={cell.date}
                  onFocus={() => setActive(cell)}
                  onPointerEnter={() => setActive(cell)}
                  style={cell.traded ? {
                    // 用 color-mix 而不是七级预设类：连续的浓度比分档更能读出大小差别
                    backgroundColor: `color-mix(in oklab, var(--${value >= 0 ? 'gain' : 'loss'}) ${
                      (12 + weight * 88).toFixed(1)}%, var(--sheet-2))`,
                  } : undefined}
                  title={`${cell.date} · ${signedMoney(value)}`}
                  type="button"
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* 读数固定在下方，不做浮动气泡：气泡在移动端会被手指盖住 */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        <span className="tnum text-xs text-ink-3">
          {active ? (
            <>
              {active.date}
              <span className={cn('ml-2 text-sm',
                active.realized_usd > 0 ? 'text-gain'
                  : active.realized_usd < 0 ? 'text-loss' : 'text-ink-2')}>
                {active.traded ? signedMoney(active.realized_usd) : '没有交易'}
              </span>
            </>
          ) : (
            <>{days.length} 天 · {traded} 天有交易 · {wins} 天为正</>
          )}
        </span>
        <span className="tnum text-xs text-ink-3">
          合计
          <span className={cn('ml-2 text-sm',
            totals >= 0 ? 'text-gain' : 'text-loss')}>{signedMoney(totals)}</span>
        </span>
      </div>
    </div>
  )
}
