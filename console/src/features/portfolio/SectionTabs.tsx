import { SegmentedControl } from '../../components/controls'

export type TabItem<K extends string = string> = {
  key: K
  label: string
  /** 该节不可用时标出来，不必点进去才发现 */
  muted?: boolean
}

/**
 * 分节导航。
 *
 * 上一版是 90 行手写的：自己量标签宽度画滑动指示条、自己接 ResizeObserver 和
 * `document.fonts.ready` 重新量、自己写左右方向键。那条会滑的指示条是好看，
 * 但代价是同一件事在这个项目里长出了第四套实现，而键盘行为各不相同。
 *
 * 现在与流水页区间、委托页筛选共用一个控件。少了动效，多了一致——
 * 而且键盘漫游与 `aria-*` 是 Radix 给的，不是我又写一遍。
 */
export function SectionTabs<K extends string>({ items, current, onSelect }: {
  items: TabItem<K>[]
  current: K
  onSelect: (key: K) => void
}) {
  return (
    <SegmentedControl
      items={items.map((item) => ({
        value: item.key, label: item.label, muted: item.muted,
      }))}
      label="分节导航"
      onValueChange={onSelect}
      value={current}
    />
  )
}
