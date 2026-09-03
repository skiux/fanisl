import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { money, signedMoney } from '../../lib/format'
import type { Pnl } from '../../api/types'

/**
 * 一个数字是怎么算出来的。
 *
 * 口径说明一直在页面上占地方，而它 99% 的时间没人看；可真要核对一个数对不对时，
 * 又非有它不可。所以不是"删掉"也不是"常驻"，是**点开才看**。
 *
 * 里面写的是构成，不是解释：这个数由哪几项加起来、每项多少、各自的窗口是什么、
 * 哪一项取不到。能照着它把数字加一遍，才叫说得清。
 */
type Part = {
  label: string
  value: number | null
  /** 这一项覆盖的时间范围。三块的窗口不一样是接口的硬限，不是选择 */
  window: string
  /** 数从哪个接口来的 */
  source: string
}

export type PnlTopic = 'today' | 'unrealized' | 'realized'

const TITLE: Record<PnlTopic, string> = {
  today: '今日盈亏',
  unrealized: '未实现盈亏',
  realized: '已实现盈亏',
}

function partsOf(topic: PnlTopic, pnl: Pnl): Part[] {
  if (topic === 'today') {
    const today = pnl.daily.at(-1)
    return [{
      label: '当日结算合计',
      value: today?.realized_usd ?? null,
      window: today?.date ?? '今天',
      source: '合约 income 按天分桶 + 现货成交结转',
    }]
  }
  if (topic === 'unrealized') {
    return [
      {
        label: '现货',
        value: pnl.unrealized.spot_usd,
        window: '此刻的持仓',
        source: '市值 − 加权平均成本（成交重放）',
      },
      {
        label: '合约',
        value: pnl.unrealized.futures_usd,
        window: '此刻的持仓',
        source: 'positionRisk 的 unRealizedProfit（交易所标记价）',
      },
    ]
  }
  return [
    {
      label: '现货',
      value: pnl.realized.spot_usd,
      window: pnl.realized.spot_scope,
      source: 'myTrades 全量重放，卖出按当时的加权平均成本结转',
    },
    {
      label: '合约',
      value: pnl.realized.futures_usd,
      window: pnl.realized.futures_scope,
      source: 'income 的 REALIZED_PNL',
    },
    { label: '资金费', value: pnl.carry.funding_usd, window: pnl.carry.scope, source: 'income 的 FUNDING_FEE' },
    { label: '手续费', value: pnl.carry.commission_usd, window: pnl.carry.scope, source: 'income 的 COMMISSION' },
    { label: '返佣', value: pnl.carry.referral_usd, window: pnl.carry.scope, source: 'income 的 REFERRAL_KICKBACK' },
  ]
}

export function PnlDetail({ topic, pnl, onClose }: {
  topic: PnlTopic | null
  pnl: Pnl | null
  onClose: () => void
}) {
  if (topic === null) return null
  const parts = pnl ? partsOf(topic, pnl) : []
  const known = parts.filter((p) => p.value !== null)
  const total = known.length ? known.reduce((sum, p) => sum + (p.value ?? 0), 0) : null
  const missing = parts.filter((p) => p.value === null)

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) onClose() }} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          // 触发器在 cells.map 里，每次开关都会重建成新节点，Radix 认不出原来那个，
          // 焦点会掉到 body 开头（实测跑到了品牌上）。这里自己把它送回去。
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLElement>(`[data-pnl-topic="${topic}"]`)?.focus()
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[86dvh] overflow-y-auto',
            'border-t border-rule bg-sheet px-5 pb-7 pt-5 shadow-[var(--sheet-shadow)]',
            // 窄屏从底部升起（拇指够得着），宽屏居中成一张纸
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(34rem,92vw)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[3px] sm:border sm:px-8 sm:pb-8',
          )}
        >
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <Dialog.Title className="font-display text-lg text-ink">{TITLE[topic]}</Dialog.Title>
            <Dialog.Close
              aria-label="关闭"
              className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-3 transition-colors duration-200 hover:bg-sheet-2 hover:text-ink"
            >
              <X aria-hidden="true" size={14} />
            </Dialog.Close>
          </div>

          {pnl === null ? (
            <p className="text-sm text-ink-3">成交记录取不到，这个数算不出来。</p>
          ) : (
            <>
              <ul className="divide-y divide-rule border-y border-rule">
                {parts.map((part) => (
                  <li className="py-3" key={part.label}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-sm text-ink">{part.label}</span>
                      <span className={cn('tnum shrink-0 text-sm',
                        part.value === null ? 'text-ink-3'
                          : part.value >= 0 ? 'text-gain' : 'text-loss')}>
                        {part.value === null ? '取不到' : signedMoney(part.value)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-ink-3">
                      {part.window} · {part.source}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink">
                  合计
                  {missing.length > 0 && (
                    <span className="ml-2 text-xs text-loss">
                      不含取不到的 {missing.length} 项
                    </span>
                  )}
                </span>
                <span className={cn('tnum text-base',
                  total === null ? 'text-ink-3' : total >= 0 ? 'text-gain' : 'text-loss')}>
                  {total === null ? '—' : signedMoney(total)}
                </span>
              </div>

              {topic === 'realized' && (
                // 三块的窗口不一样是接口的硬限。加成一个数本身就有歧义，
                // 这句话必须跟着合计一起出现，不能只写在文档里。
                <p className="mt-4 border-t border-rule pt-3 text-xs leading-relaxed text-ink-3">
                  各项的窗口不一样：现货成交没有时间上限，合约的损益接口只保留 90 天。
                  所以这个合计不是任何一个统一区间的成绩。
                </p>
              )}

              {pnl.coverage && (
                <p className="mt-2 text-xs leading-relaxed text-ink-3">{pnl.coverage}</p>
              )}
              {pnl.incomplete_assets.length > 0 && (
                <p className="mt-2 text-xs text-loss">
                  {pnl.incomplete_assets.join('、')} 的成本算不出来（缺跨币种的历史汇率），已剔除。
                </p>
              )}

              {topic === 'unrealized' && pnl.spot_assets.filter((r) => !r.is_cash).length > 0 && (
                <div className="mt-5 border-t border-rule pt-4">
                  <p className="label mb-2">现货逐个币</p>
                  <ul className="divide-y divide-rule/70">
                    {pnl.spot_assets.filter((r) => !r.is_cash).map((row) => (
                      <li className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2" key={row.asset}>
                        <span className="text-sm text-ink-2">{row.asset}</span>
                        <span className="tnum text-xs text-ink-3">
                          {row.qty} × 均价 {row.avg_cost_usd === null ? '—' : money(row.avg_cost_usd)}
                        </span>
                        <span className={cn('tnum text-right text-sm',
                          row.unrealized_usd === null ? 'text-ink-3'
                            : row.unrealized_usd >= 0 ? 'text-gain' : 'text-loss')}>
                          {row.unrealized_usd === null ? '—' : signedMoney(row.unrealized_usd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
