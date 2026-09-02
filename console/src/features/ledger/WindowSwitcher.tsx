import { SegmentedControl } from '../../components/controls'

/**
 * 查询区间。可选项由接口上限决定——30 天不是设计选的，是理财派息、杠杆利息
 * 和闪兑三个端点的单次上限，选不到更长的。
 *
 * 长相与资产页的分节、委托页的筛选走同一个控件：同一件事不该在三个页面长三张脸。
 */
export function WindowSwitcher({ days, max, onChange }: {
  days: number
  max: number
  onChange: (next: number) => void
}) {
  const options = [7, 14, 30].filter((value) => value <= max)
  return (
    <SegmentedControl
      items={options.map((value) => ({ value: String(value), label: `${value} 天` }))}
      label="查询区间"
      onValueChange={(next) => onChange(Number(next))}
      size="sm"
      value={String(days)}
    />
  )
}
