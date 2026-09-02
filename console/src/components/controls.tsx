import { ToggleGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 全站唯一的"选一个"控件。
 *
 * 之前这件事有四套实现：资产页的分节导航（90 行，自己量宽度、自己接 ResizeObserver
 * 和 fonts.ready、自己写方向键）、流水页的区间切换、委托页的账户筛选、场景切换器。
 * 四套长得都不一样，键盘行为也各不相同——"筛选项没有美感"说的其实不是配色，
 * 是同一件事在四个地方长了四张脸。
 *
 * 键盘漫游、`aria-*`、焦点管理交给 Radix 的 ToggleGroup；这里只管长相。
 * 自己写这些从来不是设计取舍，只是把无障碍写错的机会多来一次。
 */
export type SegmentItem<K extends string> = {
  value: K
  label: ReactNode
  /** 右上角的小数字：条数、金额之类 */
  badge?: ReactNode
  /** 该项不可用（取不到 / 未实现），标灰但仍可聚焦——不必点进去才发现 */
  muted?: boolean
}

export function SegmentedControl<K extends string>({
  items, value, onValueChange, size = 'md', label,
}: {
  items: SegmentItem<K>[]
  value: K
  onValueChange: (value: K) => void
  size?: 'sm' | 'md'
  label: string
}) {
  return (
    <ToggleGroup.Root
      aria-label={label}
      className={cn('flex flex-wrap items-center', size === 'sm' ? 'gap-1' : 'gap-1.5')}
      onValueChange={(next) => { if (next) onValueChange(next as K) }}
      type="single"
      value={value}
    >
      {items.map((item) => (
        <ToggleGroup.Item
          className={cn(
            'rounded-[var(--radius-control)] border transition-colors duration-200',
            'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2',
            'focus-visible:outline-accent',
            size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-xs',
            'border-transparent text-ink-3 hover:text-ink-2',
            'data-[state=on]:border-rule-strong data-[state=on]:bg-sheet-2 data-[state=on]:text-ink',
            item.muted && 'opacity-45',
          )}
          key={item.value}
          value={item.value}
        >
          {item.label}
          {item.badge !== undefined && (
            <span className="tnum ml-1.5 text-ink-3">{item.badge}</span>
          )}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

/**
 * 一段日期。用原生 `<input type="date">`：手机上直接调系统日期选择器，
 * 键盘、本地化、无障碍全都是免费的。自己写一个日历弹层是这类项目里最典型的
 * 造轮子——写出来还比原生难用。
 */
export function DateRangeInput({ from, to, min, max, onChange }: {
  from: string
  to: string
  min?: string
  max?: string
  onChange: (range: { from: string; to: string }) => void
}) {
  const field = cn(
    'tnum rounded-[var(--radius-control)] border border-rule bg-transparent',
    'px-2 py-1 text-xs text-ink-2 outline-none transition-colors duration-200',
    'hover:border-rule-strong focus-visible:border-accent',
  )
  return (
    <span className="flex items-center gap-1.5">
      <input
        aria-label="起始日期"
        className={field}
        max={to || max}
        min={min}
        onChange={(event) => onChange({ from: event.target.value, to })}
        type="date"
        value={from}
      />
      <span className="text-micro text-ink-3">至</span>
      <input
        aria-label="结束日期"
        className={field}
        max={max}
        min={from || min}
        onChange={(event) => onChange({ from, to: event.target.value })}
        type="date"
        value={to}
      />
    </span>
  )
}
