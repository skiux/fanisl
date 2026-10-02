import {
  ArrowsLeftRight, ChartPieSlice, ShieldCheck, SquaresFour, TrendUp, UsersThree,
} from '@phosphor-icons/react'
import { cn } from '../lib/cn'
import { hrefOf } from '../lib/router'

export type MainDestination = 'overview' | 'ledger' | 'holdings' | 'perp' | 'risk' | 'users'

const DESTINATIONS = [
  { key: 'overview', label: '资产', href: hrefOf('assets', 'overview'), icon: SquaresFour },
  { key: 'ledger', label: '流水', href: hrefOf('ledger'), icon: ArrowsLeftRight },
  { key: 'holdings', label: '持仓', href: hrefOf('assets', 'holdings'), icon: ChartPieSlice },
  { key: 'perp', label: '合约', href: hrefOf('assets', 'perp'), icon: TrendUp },
  { key: 'risk', label: '风险', href: hrefOf('assets', 'risk'), icon: ShieldCheck },
  // 只给管理员：成员点进去只会被退回资产页（App 里的 canView）
  { key: 'users', label: '用户', href: hrefOf('admin'), icon: UsersThree, adminOnly: true },
] as const

/** 主导航保持挂载；选中层从目标入口的中心展开。每一项宽度不变，项数多了导航条跟着变宽 */
export function BottomNavigation({ current, admin = false }: {
  current: MainDestination | null
  admin?: boolean
}) {
  const items = DESTINATIONS.filter((item) => admin || !('adminOnly' in item))
  return (
    <nav
      aria-label="资产主导航"
      className={cn(
        'vt-nav fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 rounded-full',
        'border border-rule-strong/70 bg-sheet p-1.5 lg:bottom-10',
        'shadow-[0_10px_26px_-14px_rgba(0,0,0,0.24),0_2px_6px_rgba(0,0,0,0.06)]',
      )}
    >
      <div
        className="grid w-[min(var(--nav-w),calc(100vw-2.25rem))] lg:w-[var(--nav-w)]"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
          ['--nav-w' as string]: `${items.length * 110}px`,
        }}
      >
        {items.map(({ key, label, href, icon: Icon }) => {
          const active = key === current
          return (
            <div className="relative min-w-0" key={key}>
              <span aria-hidden="true" className="nav-selection pointer-events-none absolute inset-0 rounded-full bg-ink" data-active={active} />
              <a
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative z-10 flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-full lg:h-12 lg:flex-row lg:gap-2',
                  'text-white mix-blend-difference',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  active && 'font-medium',
                )}
                href={href}
              >
                <Icon aria-hidden="true" size={18} weight="regular" />
                <span className="text-[10px] leading-none lg:text-xs">{label}</span>
              </a>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
