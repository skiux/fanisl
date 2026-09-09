import { ToggleGroup } from 'radix-ui'
import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
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


/**
 * 一个排序键。**`initial` 是这一列"要紧的排在前面"是哪一头**，第一次点它就按这个方向。
 *
 * 这个字段不是可有可无的默认值：金额、盈亏、杠杆都是从大到小要紧，而"距强平"
 * 恰恰相反——离得最近的那个仓位才是要先看的。一律给 `desc` 的话，点「距强平」
 * 会把最安全的仓位顶到最上面，正好把这个键的用处反过来。
 */
export type SortKey<K extends string> = {
  value: K
  label: string
  initial: 'asc' | 'desc'
}

export type SortState<K extends string> = { key: K; direction: 'asc' | 'desc' }

/**
 * 列表的排序条。点一个键按它排，**再点一次翻方向**，当前那个键旁边有箭头指着。
 *
 * 建在 `ToggleGroup` 上，所以键盘漫游（← →）、`aria-*`、焦点归位都是现成的；
 * 长相与 `SegmentedControl` 共用 `segmentClass`——同一页上出现两条横排小字，
 * 一条筛一条排，它们该像是同一套东西。
 *
 * **翻方向要走 `onClick` 而不是 `onValueChange`。** Radix 单选组点已选中项算
 * "取消选中"，`onValueChange` 收到的是空串（`RangePicker` 那个"自定义打不开"
 * 就是这条坑）；`onClick` 照常触发，键盘的 Enter / Space 也走它。
 */
export function SortBy<K extends string>({ keys, value, onChange, label }: {
  keys: SortKey<K>[]
  value: SortState<K>
  onChange: (next: SortState<K>) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-xs text-ink-3">{label}</span>
      <ToggleGroup.Root
        aria-label={label}
        className="flex flex-wrap items-center gap-4"
        onValueChange={(next) => {
          // 空串 = 点的是已选中那个，方向交给 onClick 翻，这里什么都不做
          if (!next) return
          const hit = keys.find((item) => item.value === next)
          if (hit) onChange({ key: hit.value, direction: hit.initial })
        }}
        type="single"
        value={value.key}
      >
        {keys.map((item) => {
          const active = item.value === value.key
          const Arrow = value.direction === 'asc' ? ArrowUp : ArrowDown
          return (
            <ToggleGroup.Item
              // 当前键的完整状态给屏幕阅读器：光一个"已按下"说不出是哪一头
              aria-label={active
                ? `按${item.label}排序，当前${value.direction === 'asc' ? '从小到大' : '从大到小'}，再按一次翻转`
                : `按${item.label}排序`}
              className={cn(segmentClass('sm', active), 'flex items-center gap-1')}
              key={item.value}
              onClick={() => {
                if (active) onChange({ key: item.value, direction: value.direction === 'asc' ? 'desc' : 'asc' })
              }}
              value={item.value}
            >
              {item.label}
              {active && <Arrow aria-hidden="true" className="translate-y-px" size={9} weight="bold" />}
            </ToggleGroup.Item>
          )
        })}
      </ToggleGroup.Root>
    </div>
  )
}

/**
 * 排序比较器。**取不到的一律排最后，跟方向无关。**
 *
 * 不这么写的话，按"距强平"升序会把一堆没有强平价的仓位（`null`）顶到最前面，
 * 而那一列恰恰是用来找"最危险的那个"的——空值冒充第一名是最坏的一种错。
 */
export function compareBy(a: number | null, b: number | null, direction: 'asc' | 'desc') {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return direction === 'asc' ? a - b : b - a
}
