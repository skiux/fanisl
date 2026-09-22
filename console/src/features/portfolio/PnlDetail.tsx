import { Dialog } from 'radix-ui'
import { X } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { Ticker } from '../../components/Ticker'
import { amount, price, signedMoney, signedPercent } from '../../lib/format'
import type { IncomeBreakdown, Pnl, SpotMarkRow } from '../../api/types'

/**
 * 「今日盈亏」这个数由哪几项加起来的。
 *
 * **一条一条列出来，不分组。** 上一版分成「现货涨跌」与「当日结算」两节，各带一行
 * 小计再缩进一层明细：两个标题、两个小计、一个合计，读者要跳三次才看到那几个数。
 * 这里总共不过七八行，直接平铺，每行自己说明自己是什么。
 *
 * 行里放的是**现价与涨跌幅**，不是「昨收 → 现价」那对箭头：箭头占掉半行宽度，
 * 而昨收本身没人要看，要看的是"涨了多少"。
 *
 * 五类东西按它们的来源排：持仓的币、正股、理财派息、杠杆利息、合约当日结算的分项。
 * **派息与利息记在稳定币上**，稳定币不参与盯市，所以它们原先在这张表里一分都看不到。
 *
 * **只放数字，不放说明。** 唯一的例外是两句：正股的昨收出处（资产页上只有这一项
 * 不来自 Binance），以及"哪只股票没算进来"。前者是数据的出处，后者是可信度警告。
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

/** 一行明细。`detail` 是中间那段可截断的补充（数量、现价、涨跌幅） */
type DetailRow = {
  key: string
  label: string
  detail?: string
  value: number | null
  /** 逐币 / 逐股那几行带标记；派息、利息与结算分类没有标的，不给 */
  mark?: boolean
}

/** 数量 · 现价 · 涨跌幅。箭头那一对价格删了：要看的是涨了多少，不是昨收是多少 */
function markDetail(row: SpotMarkRow, unit = '') {
  const change = row.prev_close_usd && row.price_usd !== null
    ? row.price_usd / row.prev_close_usd - 1 : null
  return [`${amount(row.qty)}${unit}`, price(row.price_usd),
          change === null ? null : signedPercent(change)]
    .filter(Boolean).join(' · ')
}

function markRows(marks: SpotMarkRow[], prefix: string, unit = ''): DetailRow[] {
  return [...marks]
    // **印出来是 $0.00 的不列**：灰尘币一天动不了一分钱，十几行 `+$0.00`
    // 会把真正动了的那几个挤下去。算不出来的（null）照常列，值写「—」。
    .filter((row) => row.qty > 0 && !rounded(row.today_usd))
    .sort((a, b) => magnitude(b.today_usd) - magnitude(a.today_usd))
    .map((row) => ({
      key: `${prefix}:${row.asset}`, label: row.asset, mark: true,
      detail: markDetail(row, unit), value: row.today_usd,
    }))
}

export function PnlDetail({ topic, pnl, onClose }: {
  topic: PnlTopic | null
  pnl: Pnl | null
  onClose: () => void
}) {
  if (topic === null) return null

  const today = pnl?.today
  const parts = today?.settled_parts ?? null
  const rows: DetailRow[] = pnl === null ? [] : [
    ...markRows(pnl.spot_marks, 'coin'),
    ...markRows(pnl.stock_marks, 'stock', ' 股'),
    // 行情取不到时逐币那几行本来就是空的，这一行把"取不到"说出来
    ...(today?.spot_usd === null
      ? [{ key: 'spot', label: '持仓涨跌', value: null }] : []),
    // 派息与利息各并成一行：逐个资产列出来的话，一行 USDT 看不出它是利息
    ...(rounded(today?.earn_usd ?? 0) ? [] : [{
      key: 'earn', label: '理财派息', value: today?.earn_usd ?? null,
      detail: pnl.earn_marks.map((row) => row.asset).join(' · '),
    }]),
    ...(rounded(today?.interest_usd ?? 0) ? [] : [{
      key: 'interest', label: '杠杆利息', value: today?.interest_usd ?? null,
      detail: pnl.interest_marks.map((row) => row.asset).join(' · '),
    }]),
    // 合约当日结算按类型拆开。同上：为零的分类摆在那里只是占位
    ...(parts === null
      ? [{ key: 'settled', label: '当日结算', value: today?.settled_usd ?? null }]
      : SETTLED_ROWS
        .map((row) => ({ key: row.key, label: row.label, value: parts[row.key] }))
        .filter((row) => !rounded(row.value))),
  ]

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
              <ul className="divide-y divide-rule/60 border-y border-rule">
                {rows.map(({ key, ...row }) => <Row key={key} {...row} />)}
              </ul>

              <div className="mt-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink">合计</span>
                <Amount blank="—" className="text-base" value={pnl.today.total_usd} />
              </div>

              {(pnl.stock_marks.length > 0 || pnl.equity_missing.length > 0) && (
                <p className="mt-3 text-micro leading-relaxed text-ink-3">
                  正股昨收：{pnl.equity_close_source}
                  {pnl.equity_missing.length > 0
                    && ` · ${pnl.equity_missing.join('、')} 取不到昨收，未计入`}
                </p>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({ label, detail, value, mark }: Omit<DetailRow, 'key'>) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 py-2">
      <span className="flex items-center gap-2">
        {mark && <Ticker asset={label} size="sm" />}
        <span className="text-xs text-ink-2">{label}</span>
      </span>
      <span className="tnum truncate text-[11px] text-ink-3">{detail ?? ''}</span>
      {/* 取不到与本来没有是两回事：前者写「取不到」，后者不会走到这里 */}
      <Amount blank="取不到" className="text-xs" value={value} />
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
