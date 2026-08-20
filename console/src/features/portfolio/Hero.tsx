import { cn } from '../../lib/cn'
import { money, signedMoney, signedPercent } from '../../lib/format'
import type { EquityPoint, PortfolioTotals } from '../../api/types'
import { EquityCurve } from './EquityCurve'

function splitMoney(value: number) {
  const text = money(value)
  const cut = text.lastIndexOf('.')
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

/**
 * 第一屏只回答一件事：现在有多少、今天动了多少。
 * 曲线放大到整幅——它是这页唯一的主图，之前挤在角落里等于白画。
 */
export function Hero({ totals, curve, veiled }: {
  totals: PortfolioTotals | null
  curve: EquityPoint[]
  veiled: boolean
}) {
  const [whole, cents] = totals ? splitMoney(totals.equity_usd) : ['—', '']
  const change = totals?.change_24h_usd ?? null

  return (
    <section className="px-6 pb-7 pt-8 sm:px-12 sm:pb-9 sm:pt-11">
      <div className={cn(veiled && 'veiled')}>
        <span className="label">净值</span>
        <div className="mt-3 flex items-baseline">
          <span className="tnum text-[2.5rem] font-medium leading-none tracking-[-0.035em] text-ink sm:text-[3.25rem]">
            {whole}
          </span>
          <span className="tnum text-xl font-medium leading-none tracking-[-0.02em] text-ink-3 sm:text-2xl">
            {cents}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {change === null ? (
            <span className="text-sm text-ink-3">没有昨日快照，无法给出今日变化</span>
          ) : (
            <>
              <span className={cn('tnum text-lg', change >= 0 ? 'text-gain' : 'text-loss')}>
                {signedMoney(change)}
              </span>
              <span className={cn('tnum text-sm', (totals?.change_24h_pct ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                {signedPercent(totals?.change_24h_pct ?? null)}
              </span>
              <span className="text-sm text-ink-3">今日</span>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 flex min-h-[180px] flex-col sm:mt-10 sm:min-h-[216px]">
        <EquityCurve points={curve} veiled={veiled} />
      </div>
    </section>
  )
}
