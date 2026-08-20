import { cn } from '../../lib/cn'
import { money, signedMoney, signedPercent } from '../../lib/format'
import type { Attribution } from '../../api/types'

/**
 * 整页最有价值的一句话：净值涨了不等于赚了。
 * 之前它被压成对账表里的一行，读者要自己做减法才能看出来——
 * 现在直接写成句子，四项构成排成一行，不再是七行表格。
 */
export function Insight({ data, veiled }: { data: Attribution | null; veiled: boolean }) {
  if (!data) {
    return (
      <section className="border-t border-rule px-6 py-7 sm:px-12 sm:py-9">
        <span className="label">过去 30 天</span>
        <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-ink-2">
          这一段算不出来——需要期初净值（日快照）、收支流水与充提记录同时可用。
          缺任一项恒等式就不闭合，与其给一个对不上账的结论，不如空着。
        </p>
      </section>
    )
  }

  const netChange = data.closing_equity - data.opening_equity
  const parts: Array<[string, number]> = [
    ['已实现', data.realized_pnl],
    ['未实现', data.unrealized_delta],
    ['资金费', data.funding_fee],
    ['手续费', data.commission],
  ]

  return (
    <section className={cn('border-t border-rule px-6 py-7 sm:px-12 sm:py-9', veiled && 'veiled')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
        <span className="label">过去 30 天</span>
        <span className="text-xs text-ink-3">窗口固定 30 天 · 受日快照接口所限</span>
      </div>

      <p className="mt-4 max-w-[46ch] font-display text-xl leading-[1.55] text-ink sm:text-2xl">
        净值增加 <span className="tnum">{signedMoney(netChange)}</span>，
        其中 <span className="tnum text-accent">{signedMoney(data.net_transfer)}</span> 是转入的；
        实际赚了{' '}
        <span className={cn('tnum', data.true_pnl >= 0 ? 'text-gain' : 'text-loss')}>
          {signedMoney(data.true_pnl)}
        </span>
        <span className={cn('tnum text-lg', data.true_pnl >= 0 ? 'text-gain' : 'text-loss')}>
          （{signedPercent(data.true_return)}）
        </span>
        。
      </p>

      <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-14">
        {parts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className={cn('tnum mt-1 text-base', value >= 0 ? 'text-gain' : 'text-loss')}>
              {signedMoney(value)}
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-ink-3">期初净值</dt>
          <dd className="tnum mt-1 text-base text-ink-2">{money(data.opening_equity)}</dd>
        </div>
      </dl>
    </section>
  )
}
