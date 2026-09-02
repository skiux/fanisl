import { cn } from '../../lib/cn'
import { money, percent, signedMoney, signedPercent } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'

type Cell = {
  label: string
  value: string
  note?: string
  tone?: 'gain' | 'loss' | 'muted'
}

/**
 * 常驻摘要条。分节导航只管导航，摘要另立一行——
 * 上一版把两件事塞进同一根侧栏，结果既不像导航也不像摘要，还吃掉 224px 宽度。
 */
export function SummaryStrip({ snapshot, futuresMissing, veiled }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  veiled: boolean
}) {
  const totals = snapshot.totals
  const a = snapshot.attribution
  const ratio = snapshot.futures?.margin_ratio ?? null

  const cells: Cell[] = [
    {
      label: '今日',
      value: totals?.change_24h_usd == null ? '—' : signedMoney(totals.change_24h_usd),
      note: totals?.change_24h_pct == null ? '无昨日快照' : signedPercent(totals.change_24h_pct),
      tone: totals?.change_24h_usd == null ? 'muted' : totals.change_24h_usd >= 0 ? 'gain' : 'loss',
    },
    {
      // 天数照实说：日快照只保留 30 天，账户不满 30 天或中间缺日，窗口就短一截，
      // 写死"30 天"会把一个 9 天的数字讲成一个月的成绩
      label: a ? `${a.window_days} 天真实盈亏` : '真实盈亏',
      value: a ? signedMoney(a.true_pnl) : '—',
      note: a ? `${signedPercent(a.true_return)} · 已剔除充提` : '不可用',
      tone: a ? (a.true_pnl >= 0 ? 'gain' : 'loss') : 'muted',
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

      {cells.map((cell) => (
        <div className="pb-1" key={cell.label}>
          <span className="label">{cell.label}</span>
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
          {cell.note && <div className="mt-1 text-xs text-ink-3">{cell.note}</div>}
        </div>
      ))}
    </div>
  )
}
