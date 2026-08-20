import { useState, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { money, signedMoney } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import { EarnTable, SpotTable } from './Holdings'
import { PositionsList } from './RiskPanel'

function Disclosure({ label, count, value, tone, children }: {
  label: string
  count: string
  value: string
  tone?: 'gain' | 'loss' | 'muted'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-rule last:border-b-0">
      <button
        aria-expanded={open}
        className="group flex w-full items-baseline gap-4 py-4 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <CaretRight
          aria-hidden="true"
          className={cn('translate-y-px shrink-0 text-ink-3 transition-transform duration-300', open && 'rotate-90')}
          size={12}
        />
        <span className="text-base text-ink transition-colors group-hover:text-accent">{label}</span>
        <span className="tnum text-xs text-ink-3">{count}</span>
        <span className={cn('tnum ml-auto text-sm',
          tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'muted' ? 'text-ink-3' : 'text-ink')}>
          {value}
        </span>
      </button>
      <div className="collapsible" data-open={open}>
        <div><div className="pb-5">{children}</div></div>
      </div>
    </div>
  )
}

/**
 * 明细默认收起。这一页要回答的三个问题在上面已经答完了；
 * 把 40 多行数据同时摊开，只会把答案埋掉——之前正是这么做的。
 */
export function Details({ snapshot, futuresMissing, veiled }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  veiled: boolean
}) {
  const spotValue = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const earnValue = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const positions = snapshot.futures?.positions ?? []
  const upnl = positions.reduce((sum, p) => sum + p.unrealized_pnl_usd, 0)

  return (
    <section className={cn('border-t border-rule px-6 py-6 sm:px-12 sm:py-7', veiled && 'veiled')}>
      <span className="label">明细</span>
      <div className="mt-1">
        <Disclosure count={`${snapshot.spot.length} 项`} label="现货持仓" value={money(spotValue)}>
          <SpotTable spot={snapshot.spot} />
        </Disclosure>

        <Disclosure count={`${snapshot.earn.length} 项`} label="理财持仓" value={money(earnValue)}>
          <EarnTable earn={snapshot.earn} />
        </Disclosure>

        <Disclosure
          count={futuresMissing ? '不可用' : `${positions.length} 笔`}
          label="合约仓位"
          tone={futuresMissing ? 'muted' : upnl >= 0 ? 'gain' : 'loss'}
          value={futuresMissing ? '—' : signedMoney(upnl)}
        >
          <PositionsList futures={snapshot.futures} unavailable={futuresMissing} />
        </Disclosure>
      </div>
    </section>
  )
}
