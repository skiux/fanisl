import {
  ArrowsLeftRight, ChartPieSlice, ShieldCheck, SquaresFour, TrendUp,
} from '@phosphor-icons/react'
import { cn } from '../lib/cn'
import { hrefOf } from '../lib/router'

export type MainDestination = 'overview' | 'ledger' | 'holdings' | 'perp' | 'risk'

const DESTINATIONS = [
  { key: 'overview', label: '资产', href: hrefOf('assets', 'overview'), icon: SquaresFour },
  { key: 'ledger', label: '流水', href: hrefOf('ledger'), icon: ArrowsLeftRight },
  { key: 'holdings', label: '持仓', href: hrefOf('assets', 'holdings'), icon: ChartPieSlice },
  { key: 'perp', label: '合约', href: hrefOf('assets', 'perp'), icon: TrendUp },
  { key: 'risk', label: '风险', href: hrefOf('assets', 'risk'), icon: ShieldCheck },
] as const

/** 主导航保持挂载，切页时选中层沿五个等宽槽位移动。 */
export function BottomNavigation({ current }: { current: MainDestination | null }) {
  const activeIndex = DESTINATIONS.findIndex(({ key }) => key === current)
  const indicatorStyle = { transform: `translate3d(${activeIndex * 100}%, 0, 0)` }

  return (
    <nav
      aria-label="资产主导航"
      className={cn(
        'vt-nav fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 rounded-full',
        'border border-rule-strong/70 bg-sheet/95 p-1.5 backdrop-blur-xl lg:bottom-10',
        'shadow-[0_12px_32px_-12px_rgba(0,0,0,0.30),0_2px_8px_rgba(0,0,0,0.08)]',
      )}
    >
      <div className="relative grid w-[min(550px,calc(100vw-2.25rem))] grid-cols-5 lg:w-[550px]">
        {activeIndex >= 0 && (
          <>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-full bg-ink/15 blur-[9px] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none" style={indicatorStyle} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-full bg-ink transition-transform duration-[430ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={indicatorStyle} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/5" style={indicatorStyle}>
              <span className="nav-diffusion block h-full w-full rounded-full bg-ink" key={current} />
            </span>
          </>
        )}
        {DESTINATIONS.map(({ key, label, href, icon: Icon }) => {
          const active = key === current
          return (
            <a
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative z-10 flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-full lg:h-12 lg:flex-row lg:gap-2',
                'text-white mix-blend-difference',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                active && 'font-medium',
              )}
              href={href}
              key={key}
            >
              <Icon aria-hidden="true" size={18} weight="regular" />
              <span className="text-[10px] leading-none lg:text-xs">{label}</span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}
