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

/**
 * 分段项的长相。单独导出是因为**有些"选一个"不能用 ToggleGroup**——
 * Radix 在点已选中项时不触发 `onValueChange`（单选组里那是"取消选中"），
 * 于是"自定义区间"选过一次之后再点就打不开选择器了。那种要另开一个按钮，
 * 但长相必须一样。
 */
export function segmentClass(size: 'sm' | 'md' = 'md', active = false) {
  return cn(
    'relative whitespace-nowrap pb-1 outline-none transition-colors duration-200',
    'after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left',
    'after:scale-x-0 after:bg-ink after:transition-transform after:duration-200',
    'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4',
    'focus-visible:outline-accent',
    size === 'sm' ? 'text-xs' : 'text-sm',
    active ? 'text-ink after:scale-x-100' : 'text-ink-3 hover:text-ink-2',
  )
}

export function SegmentedControl<K extends string>({
  items, value, onValueChange, size = 'md', label,
}: {
  items: SegmentItem<K>[]
  /** `''` = 一个都没选中（旁边另有一个不属于本组的选项处于选中态） */
  value: K | ''
  onValueChange: (value: K) => void
  size?: 'sm' | 'md'
  label: string
}) {
  return (
    <ToggleGroup.Root
      aria-label={label}
      className={cn('flex flex-wrap items-center', size === 'sm' ? 'gap-4' : 'gap-5')}
      onValueChange={(next) => { if (next) onValueChange(next as K) }}
      type="single"
      value={value}
    >
      {items.map((item) => (
        <ToggleGroup.Item
          className={cn(
            // 选中态只用颜色 + 一条下划线，不用方框。报头导航一直就是这么写的
            // （current ? text-ink : text-ink-3）——上一版给它套了边框和底色，
            // 在这套纸面语言里读着像一个禁用的按钮。
            'relative whitespace-nowrap pb-1 outline-none transition-colors duration-200',
            'text-ink-3 hover:text-ink-2 data-[state=on]:text-ink',
            'after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left',
            'after:scale-x-0 after:bg-ink after:transition-transform after:duration-200',
            'data-[state=on]:after:scale-x-100',
            'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4',
            'focus-visible:outline-accent',
            size === 'sm' ? 'text-xs' : 'text-sm',
            item.muted && 'opacity-40',
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
