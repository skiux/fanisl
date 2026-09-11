export type DonutSlice = { key: string; value: number; color: string }

/** 占比不把非零的小额四舍五入成 0%，也不把接近满仓的数提前写成 100%。 */
export function allocationPercent(share: number) {
  if (share === 0) return '0%'
  if (share < 0.0001) return '<0.01%'
  if (share < 1 && share > 0.9999) return '>99.99%'
  return `${(share * 100).toFixed(share < 0.01 || share > 0.999 ? 2 : 1)}%`
}

export function sliceLayout(slices: DonutSlice[]) {
  const valid = slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
  const total = valid.reduce((sum, slice) => sum + slice.value, 0)
  let cursor = -Math.PI / 2
  return valid.map((slice, index) => {
    const share = slice.value / total
    const start = cursor
    // 最后一块闭合圆周，避免浮点累加在十二点处留下缝隙。
    cursor = index === valid.length - 1 ? Math.PI * 1.5 : cursor + share * Math.PI * 2
    return { ...slice, share, start, end: cursor }
  })
}

/** 环带独立于标签和交互；满圈由两个半圆构成，不会退化成重合的起终点。 */
export function ringPath(center: number, inner: number, outer: number, start: number, end: number): string {
  const at = (r: number, angle: number) => `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`
  if (end - start >= Math.PI * 2 - 1e-10) {
    return `M${at(outer, start)} A${outer},${outer} 0 1 1 ${at(outer, start + Math.PI)}`
      + ` A${outer},${outer} 0 1 1 ${at(outer, end)} Z`
      + ` M${at(inner, start)} A${inner},${inner} 0 1 0 ${at(inner, start + Math.PI)}`
      + ` A${inner},${inner} 0 1 0 ${at(inner, end)} Z`
  }
  const large = end - start > Math.PI ? 1 : 0
  return `M${at(outer, start)} A${outer},${outer} 0 ${large} 1 ${at(outer, end)}`
    + ` L${at(inner, end)} A${inner},${inner} 0 ${large} 0 ${at(inner, start)} Z`
}
