import { CalendarBlank } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'

/**
 * 查询区间。可选项由接口上限决定——30 天不是设计选的，是理财派息、杠杆利息
 * 和闪兑三个端点的单次上限，选不到更长的。
 */
export function WindowSwitcher({ days, max, onChange }: {
  days: number
  max: number
  onChange: (next: number) => void
}) {
  const options = [7, 14, 30].filter((value) => value <= max)
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-2 py-1">
      <CalendarBlank aria-hidden="true" className="text-ink-3" size={13} />
      <span className="sr-only">查询区间</span>
      {options.map((value) => (
        <button
          aria-pressed={value === days}
          className={cn(
            'rounded-[3px] px-1.5 text-[12px] transition-colors duration-200',
            value === days ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {value}<span className="hidden sm:inline"> 天</span>
        </button>
      ))}
    </div>
  )
}
