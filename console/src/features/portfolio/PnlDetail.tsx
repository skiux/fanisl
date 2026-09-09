import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { amount, price, signedMoney, signedPercent } from '../../lib/format'
import type { IncomeBreakdown, Pnl } from '../../api/types'

/**
 * 「今日盈亏」这个数由哪几项加起来的。
 *
 * 两项：现货持仓当天涨跌了多少，加上合约当天结算掉的。和日历最后一格同源——
 * 上一版今天与日历各算各的，屏幕上两个数对不上。
 *
 * **两项都要能再拆一层。** 上一版现货那半边挂着一张逐币表，可它浮在最底下，
 * 和「现货涨跌」那一行隔着「合计」；合约那半边则干脆没有下一层，只有一个
 * −$12.30，看不出是资金费还是手续费——同一个合计在「合约收支」那张 90 天表里
 * 明明是拆开的。现在两项各带各的明细，缩进挂在自己那一行下面。
 *
 * **只放数字，不放说明。** 上一版把页面上删掉的口径原样搬进这里——换个地方又写了
 * 一遍，而且对所有人可见。这里要回答的是"这个数怎么凑出来的"，那是数据；
 * "它取自哪个接口""窗口多长"是构造，属于 README。
 *
 * 只剩「今日盈亏」一个可点：合约未实现是 positionRisk 直接给的一个数，
 * 拆不出下一层；而现货那半边已经不存在未实现了。
 */
export type PnlTopic = 'today'

/** 当日结算的分项。标签与「合约收支」那张 90 天表一字不差——本来就是同一套分类 */
const SETTLED_ROWS: { key: keyof IncomeBreakdown; label: string }[] = [
  { key: 'realized_pnl', label: '已实现盈亏' },
  { key: 'funding_fee', label: '资金费' },
  { key: 'commission', label: '手续费' },
  { key: 'referral_kickback', label: '返佣' },
  { key: 'insurance_clear', label: '保险清算' },
  { key: 'other', label: '其他' },
]

/** 排序用的量级。算不出来的排最后，别让一排 `—` 占住开头 */
const magnitude = (value: number | null) => (value === null ? -1 : Math.abs(value))

/**
 * 这个数印出来会不会是 `$0.00`。阈值就是 `signedMoney` 的进位边界（两位小数），
 * 判 `=== 0` 不够：0.004 也印成 `+$0.00`，摆在那里同样只是占位。
 * **`null` 不算**——取不到和是 0 是两回事，那一行要留着。
 */
const rounded = (value: number | null) => value !== null && Math.abs(value) < 0.005

export function PnlDetail({ topic, pnl, onClose }: {
  topic: PnlTopic | null
  pnl: Pnl | null
  onClose: () => void
}) {
  if (topic === null) return null

  // 逐币的涨跌，大的在前。**印出来是 $0.00 的不列**：灰尘币一天动不了一分钱，
  // 十几行 `+$0.00` 会把真正动了的那几个挤下去。
  // 算不出来的（`null`）照常列出来，值写 `取不到`——那不是 0，是另一回事，
  // 而且底下再补一句"某某没有报价"是把表格已经说清的事又说一遍。
  const coins = [...(pnl?.spot_marks ?? [])]
    .filter((row) => row.qty > 0 && !rounded(row.today_usd))
    .sort((a, b) => magnitude(b.today_usd) - magnitude(a.today_usd))

  const parts = pnl?.today.settled_parts ?? null
  // 同上：为零的分类摆在那里只是占位，"今天没有资金费"不需要单独说一行
  const settled = parts === null ? [] : SETTLED_ROWS
    .map((row) => ({ label: row.label, value: parts[row.key] }))
    .filter((row) => !rounded(row.value))

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
          // 触发器在摘要条的 cells.map 里，每次开关都重建成新节点，Radix 认不出
          // 原来那个，焦点会掉到 body 开头。这里自己把它送回去。
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLElement>(`[data-strip-cell="${topic}"]`)?.focus()
          }}
        >
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <Dialog.Title className="font-display text-lg text-ink">今日盈亏</Dialog.Title>
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
              <div className="border-b border-rule">
                <Part
                  label="现货涨跌"
                  rows={coins.map((row) => {
                    const change = row.prev_close_usd && row.price_usd !== null
                      ? row.price_usd / row.prev_close_usd - 1 : null
                    return (
                      <Row
                        detail={`${amount(row.qty)} · ${price(row.prev_close_usd)} → ${price(row.price_usd)}${
                          change === null ? '' : ` · ${signedPercent(change)}`}`}
                        key={row.asset}
                        label={row.asset}
                        value={row.today_usd}
                      />
                    )
                  })}
                  value={pnl.today.spot_usd}
                />
                <Part label="当日结算" rows={settled.map((row) => (
                  <Row key={row.label} label={row.label} value={row.value} />
                ))} value={pnl.today.settled_usd} />
              </div>

              <div className="mt-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink">合计</span>
                <Amount blank="—" className="text-base" value={pnl.today.total_usd} />
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** 一项：自己的合计一行，明细缩在下面。明细为空时不留空档 */
function Part({ label, value, rows }: {
  label: string
  value: number | null
  rows: ReactNode[]
}) {
  return (
    <section className="border-t border-rule py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink-2">{label}</span>
        <Amount blank="取不到" className="text-sm" value={value} />
      </div>
      {rows.length > 0 && (
        // 明细缩进一格，和上面那行拉开层级；细分隔线只在明细之间，
        // 不和分节的实线抢
        <ul className="mt-1.5 divide-y divide-rule/60 pl-3">{rows}</ul>
      )}
    </section>
  )
}

/** 明细的一行。`detail` 是中间那段可截断的补充（数量、价格、涨跌幅） */
function Row({ label, detail, value }: {
  label: string
  detail?: string
  value: number | null
}) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-1.5">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="tnum truncate text-[11px] text-ink-3">{detail ?? ''}</span>
      <Amount blank="—" className="text-xs" value={value} />
    </li>
  )
}

function Amount({ value, blank, className }: {
  value: number | null
  /** 没有这个数时印什么：来源挂了写「取不到」，本来就没有写「—」 */
  blank: string
  className?: string
}) {
  return (
    <span className={cn('tnum shrink-0 text-right',
      value === null ? 'text-ink-3' : value >= 0 ? 'text-gain' : 'text-loss',
      className)}>
      {value === null ? blank : signedMoney(value)}
    </span>
  )
}
