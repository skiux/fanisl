import { cn } from '../../lib/cn'

export type ViewKey = 'overview' | 'changes' | 'spot' | 'earn' | 'perp' | 'risk'

export type NavItem = {
  key: ViewKey
  index: string
  label: string
  figure: string | null
  tone?: 'gain' | 'loss' | 'muted'
  note?: string
}

/**
 * 导航即摘要。
 * 六个入口各自带着本节的头条数字——不点也能一眼看全六个答案；
 * 点进去才是那一节的完整明细。摘要留在这一列，明细只占右边一块，
 * 页面因此既不堆、也不需要深滚。
 */
export function NavRail({ items, current, onSelect }: {
  items: NavItem[]
  current: ViewKey
  onSelect: (key: ViewKey) => void
}) {
  return (
    <nav aria-label="报表分节" className="flex flex-col px-3 py-3 lg:px-4 lg:py-5">
      {items.map((item) => {
        const active = current === item.key
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group w-full rounded-[6px] px-3 py-2.5 text-left transition-colors duration-200',
              active ? 'bg-sheet-2' : 'hover:bg-sheet-2/55',
            )}
            key={item.key}
            onClick={() => onSelect(item.key)}
            type="button"
          >
            <span className="flex items-baseline gap-2.5">
              <span className={cn('section-index shrink-0', active && 'text-ink-2')}>{item.index}</span>
              <span className={cn('whitespace-nowrap text-sm', active ? 'text-ink' : 'text-ink-2 group-hover:text-ink')}>
                {item.label}
              </span>
            </span>
            {item.figure && (
              <span
                className={cn(
                  'tnum mt-1 block text-base',
                  item.tone === 'gain' ? 'text-gain'
                    : item.tone === 'loss' ? 'text-loss'
                      : item.tone === 'muted' ? 'text-ink-3' : 'text-ink',
                )}
              >
                {item.figure}
              </span>
            )}
            {item.note && <span className="mt-0.5 block text-micro text-ink-3">{item.note}</span>}
          </button>
        )
      })}
    </nav>
  )
}
