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

/** 桌面主导航悬浮在报表上方；明细仍独立滚动，末尾留出可到达的空间。 */
export function BottomNavigation({ current }: { current: MainDestination | null }) {
  return (
    <nav
      aria-label="资产主导航"
      className={cn(
        'fixed bottom-10 left-1/2 z-30 hidden -translate-x-1/2 rounded-full',
        'border border-rule-strong/70 bg-sheet/95 p-1.5 backdrop-blur-xl lg:block',
        'shadow-[0_12px_32px_-12px_rgba(0,0,0,0.30),0_2px_8px_rgba(0,0,0,0.08)]',
      )}
    >
      <div className="grid w-[min(550px,calc(100vw-6rem))] grid-cols-5 gap-1">
        {DESTINATIONS.map(({ key, label, href, icon: Icon }) => {
          const active = key === current
          return (
            <a
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-12 min-w-0 items-center justify-center gap-2 rounded-full',
                'transition-colors duration-200',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'bg-ink font-medium text-sheet'
                  : 'text-ink-2 hover:bg-sheet-2 hover:text-ink',
              )}
              href={href}
              key={key}
            >
              <Icon aria-hidden="true" size={17} weight="regular" />
              <span className="text-xs leading-none">{label}</span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}
