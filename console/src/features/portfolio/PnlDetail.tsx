import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { amount, money, signedMoney } from '../../lib/format'
import type { Pnl } from '../../api/types'

/**
 * 一个数字由哪几项加起来的。
 *
 * **只放数字，不放说明。** 上一版把页面上删掉的口径原样搬进这里——换个地方又写了
 * 一遍，而且对所有人可见。这里要回答的是"这个数怎么凑出来的"，那是数据；
 * "它取自哪个接口""窗口多长"是构造，属于 README。
 */
export type PnlTopic = 'today' | 'unrealized'

const TITLE: Record<PnlTopic, string> = { today: '今日盈亏', unrealized: '未实现盈亏' }

export function PnlDetail({ topic, pnl, onClose }: {
  topic: PnlTopic | null
  pnl: Pnl | null
  onClose: () => void
}) {
  if (topic === null) return null

  const parts = pnl === null ? [] : topic === 'today'
    ? [{ label: '当日结算', value: pnl.daily.at(-1)?.realized_usd ?? null }]
    : [{ label: '现货', value: pnl.unrealized.spot_usd },
       { label: '合约', value: pnl.unrealized.futures_usd }]
  const known = parts.filter((p) => p.value !== null)
  const total = known.length ? known.reduce((sum, p) => sum + (p.value ?? 0), 0) : null
  const coins = pnl?.spot_assets.filter((r) => !r.is_cash && r.qty > 0) ?? []
  // 没见过买入记录的那部分不参与盈亏，但要说出来——否则合计看着像"少算了"
  const unpriced = coins.filter((r) => r.unpriced_qty > 0)

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) onClose() }} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[86dvh] overflow-y-auto',
            'border-t border-rule bg-sheet px-5 pb-7 pt-5 shadow-[var(--sheet-shadow)]',
            // 窄屏从底部升起（拇指够得着），宽屏居中成一张纸
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(30rem,92vw)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[3px] sm:border sm:px-8 sm:pb-8',
          )}
          // 触发器在 cells.map 里，每次开关都重建成新节点，Radix 认不出原来那个，
          // 焦点会掉到 body 开头。这里自己把它送回去。
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLElement>(`[data-pnl-topic="${topic}"]`)?.focus()
          }}
        >
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <Dialog.Title className="font-display text-lg text-ink">{TITLE[topic]}</Dialog.Title>
            <Dialog.Close
              aria-label="关闭"
              className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-3 transition-colors duration-200 hover:bg-sheet-2 hover:text-ink"
            >
              <X aria-hidden="true" size={14} />
            </Dialog.Close>
          </div>

          {pnl === null ? (
            <p className="text-sm text-ink-3">取不到。</p>
          ) : (
            <>
              <ul className="divide-y divide-rule border-y border-rule">
                {parts.map((part) => (
                  <li className="flex items-baseline justify-between gap-4 py-2.5" key={part.label}>
                    <span className="text-sm text-ink-2">{part.label}</span>
                    <span className={cn('tnum shrink-0 text-sm',
                      part.value === null ? 'text-ink-3'
                        : part.value >= 0 ? 'text-gain' : 'text-loss')}>
                      {part.value === null ? '取不到' : signedMoney(part.value)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink">合计</span>
                <span className={cn('tnum text-base',
                  total === null ? 'text-ink-3' : total >= 0 ? 'text-gain' : 'text-loss')}>
                  {total === null ? '—' : signedMoney(total)}
                </span>
              </div>

              {topic === 'unrealized' && coins.length > 0 && (
                <div className="mt-5 border-t border-rule pt-4">
                  <p className="label mb-2">现货</p>
                  <ul className="divide-y divide-rule/70">
                    {coins.map((row) => (
                      <li className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 py-2" key={row.asset}>
                        <span className="text-sm text-ink-2">{row.asset}</span>
                        <span className="tnum truncate text-xs text-ink-3">
                          {amount(row.qty)}
                          {row.avg_cost_usd !== null && ` × ${money(row.avg_cost_usd)}`}
                          {row.unpriced_qty > 0 && (
                            <span className="text-loss">
                              {` （${amount(row.unpriced_qty)} 成本不明）`}
                            </span>
                          )}
                        </span>
                        <span className={cn('tnum text-right text-sm',
                          row.unrealized_usd === null ? 'text-ink-3'
                            : row.unrealized_usd >= 0 ? 'text-gain' : 'text-loss')}>
                          {row.unrealized_usd === null ? '—' : signedMoney(row.unrealized_usd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {unpriced.length > 0 && (
                    <p className="mt-3 text-xs leading-relaxed text-loss">
                      标注的数量没有买入记录（划转、理财、小额兑换进来的），成本算不出来，
                      不计入盈亏。
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
