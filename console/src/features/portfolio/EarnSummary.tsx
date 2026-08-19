import { Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, percent } from '../../lib/format'
import type { EarnPosition } from '../../api/types'

/** 理财是六个钱包里唯一自己会长钱的一个，值得在概览里有一行位置 */
export function EarnSummary({ earn, veiled }: { earn: EarnPosition[]; veiled: boolean }) {
  if (earn.length === 0) return null

  const priced = earn.filter((item) => item.value_usd !== null && item.apr !== null)
  const total = priced.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const weightedApr = total > 0
    ? priced.reduce((sum, item) => sum + (item.value_usd ?? 0) * (item.apr ?? 0), 0) / total
    : null
  const rewards = earn.reduce((sum, item) => sum + (item.cumulative_rewards_usd ?? 0), 0)
  const nextRedeem = earn
    .filter((item) => item.redeem_date)
    .sort((a, b) => (a.redeem_date ?? '').localeCompare(b.redeem_date ?? ''))[0]

  return (
    <section className={cn('border-t border-line pt-3', veiled && 'veiled')}>
      <Eyebrow>理财</Eyebrow>
      <dl className="mt-2 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-fg-3">加权年化</dt>
          <dd className="tnum text-xs text-gain">{weightedApr === null ? '—' : percent(weightedApr, 2)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-fg-3">累计收益</dt>
          <dd className="tnum text-xs text-fg-2">{money(rewards)}</dd>
        </div>
        {nextRedeem && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-fg-3">最近到期</dt>
            <dd className="tnum text-xs text-fg-2">
              {nextRedeem.redeem_date}<span className="text-fg-3"> · {nextRedeem.asset}</span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
