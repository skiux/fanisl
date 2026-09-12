export type AllocationItem = { key: string; value: number; color: string }

export type AllocationSlice = AllocationItem & {
  share: number
  start: number
  end: number
}

/** 占比不把非零的小额四舍五入成 0%，也不把接近满仓的数提前写成 100%。 */
export function allocationPercent(share: number) {
  if (share === 0) return '0%'
  const sign = share < 0 ? '−' : ''
  const magnitude = Math.abs(share)
  if (magnitude < 0.0001) return `${sign}<0.01%`
  if (magnitude < 1 && magnitude > 0.9999) return `${sign}>99.99%`
  return `${sign}${(magnitude * 100).toFixed(magnitude < 0.01 || magnitude > 0.999 ? 2 : 1)}%`
}

/** 扇区从十二点开始，按金额降序顺时针排列；最后一块强制闭合，避免浮点缝隙。 */
export function allocationSlices(items: AllocationItem[]): AllocationSlice[] {
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  const total = valid.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) return []
  let cursor = -Math.PI / 2
  return valid.map((item, index) => {
    const share = item.value / total
    const start = cursor
    cursor = index === valid.length - 1 ? Math.PI * 1.5 : cursor + share * Math.PI * 2
    return { ...item, share, start, end: cursor }
  })
}

const point = (center: number, radius: number, angle: number) =>
  `${center + Math.cos(angle) * radius},${center + Math.sin(angle) * radius}`

/** 满圈分成两个半圆，避免 SVG 把重合的起终点当成空路径。 */
export function ringPath(center: number, inner: number, outer: number, start: number, end: number) {
  if (end - start >= Math.PI * 2 - 1e-10) {
    return `M${point(center, outer, start)} A${outer},${outer} 0 1 1 ${point(center, outer, start + Math.PI)}`
      + ` A${outer},${outer} 0 1 1 ${point(center, outer, end)} Z`
      + ` M${point(center, inner, start)} A${inner},${inner} 0 1 0 ${point(center, inner, start + Math.PI)}`
      + ` A${inner},${inner} 0 1 0 ${point(center, inner, end)} Z`
  }
  const large = end - start > Math.PI ? 1 : 0
  return `M${point(center, outer, start)} A${outer},${outer} 0 ${large} 1 ${point(center, outer, end)}`
    + ` L${point(center, inner, end)} A${inner},${inner} 0 ${large} 0 ${point(center, inner, start)} Z`
}
