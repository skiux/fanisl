import { cn } from '../../lib/cn'
import { money, percent, signedMoney } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import type { PnlTopic } from './PnlDetail'

type Cell = {
  label: string
  value: string
  note?: string
  tone?: 'gain' | 'loss' | 'muted'
  /** 可以点开看这个数是怎么算的。没有 topic 的格子不可点 */
  topic?: PnlTopic
}

/**
 * 常驻摘要条。分节导航只管导航，摘要另立一行——
 * 上一版把两件事塞进同一根侧栏，结果既不像导航也不像摘要，还吃掉 224px 宽度。
 */
export function SummaryStrip({ snapshot, futuresMissing, veiled, onOpenDetail }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  veiled: boolean
  onOpenDetail: (topic: PnlTopic) => void
}) {
  const totals = snapshot.totals
  const pnl = snapshot.pnl
  const ratio = snapshot.futures?.margin_ratio ?? null

  // 现货与合约各有各的取不到的可能：一边缺就只报另一边，别把 null 当 0 加进去
  const sum = (...parts: (number | null | undefined)[]) => {
    const known = parts.filter((p): p is number => p != null)
    return known.length ? known.reduce((a, b) => a + b, 0) : null
  }
  const unreal = sum(pnl?.unrealized.spot_usd, pnl?.unrealized.futures_usd)

  const cells: Cell[] = [
    {
      // 原先是"今日净值变化"，拿全部钱包减昨天的日快照——理财余额每天都被算成
      // "今天赚的"。改成今日实际落袋，只认成交与结算。
      label: '今日盈亏',
      topic: 'today' as const,
      value: pnl?.today_usd == null ? '—' : signedMoney(pnl.today_usd),

      tone: pnl?.today_usd == null ? 'muted' : pnl.today_usd >= 0 ? 'gain' : 'loss',
    },
    {
      // 未实现盈亏来自成交重放（现货）与 positionRisk（合约），不是"期末 − 期初"。
      // 后者在 Binance 上算不准：日快照只有三个钱包，钱包间划转会被算成盈亏。
      label: '未实现盈亏',
      topic: 'unrealized' as const,
      value: unreal == null ? '—' : signedMoney(unreal),
      note: unreal == null ? '不可用' : undefined,
      tone: unreal == null ? 'muted' : unreal >= 0 ? 'gain' : 'loss',
    },
    {
      label: '合约保证金率',
      value: ratio === null ? '—' : percent(ratio, 1),
      note: futuresMissing ? '取不到' : ratio === null ? '—' : ratio < 0.5 ? '安全' : ratio < 0.8 ? '偏紧' : '危险',
      tone: ratio === null ? 'muted' : undefined,
    },
  ]

  return (
    <div className={cn('flex flex-wrap items-end gap-x-14 gap-y-5 px-5 pb-4 pt-4 sm:px-10 sm:pb-5 sm:pt-5', veiled && 'veiled')}>
      <div>
        <span className="label">净值</span>
        <div className="tnum mt-2 text-[2rem] font-medium leading-none tracking-[-0.03em] text-ink sm:text-[2.5rem]">
          {totals ? money(totals.equity_usd) : '—'}
        </div>
      </div>

      {cells.map((cell) => {
        const body = (
          <>
            <span className={cn('label', cell.topic && 'group-hover:text-ink-2')}>
              {cell.label}
            </span>
            <div
              className={cn(
                'tnum mt-1.5 text-lg leading-none',
                cell.tone === 'gain' ? 'text-gain'
                  : cell.tone === 'loss' ? 'text-loss'
                    : cell.tone === 'muted' ? 'text-ink-3' : 'text-ink',
              )}
            >
              {cell.value}
            </div>
            {/* 只留**读数**：把数字翻成一句判断（"安全""取不到"）。
                口径——这个数怎么算出来的——收进点开的详情里。 */}
            {cell.note && <div className="mt-1 text-xs text-ink-3">{cell.note}</div>}
          </>
        )
        if (!cell.topic) return <div className="pb-1" key={cell.label}>{body}</div>
        return (
          <button
            className={cn('group pb-1 text-left outline-none',
              // 下划虚线是"这里能点"的最轻提示，不给它加边框或底色——
              // 摘要条是一排读数，不是一排按钮
              'decoration-rule-strong underline-offset-[6px] hover:underline hover:decoration-dotted',
              'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4',
              'focus-visible:outline-accent')}
            data-pnl-topic={cell.topic}
            key={cell.label}
            onClick={() => onOpenDetail(cell.topic!)}
            type="button"
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
