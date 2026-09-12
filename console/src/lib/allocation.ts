export type AllocationItem = { key: string; value: number; color: string }

export type AllocationTile = AllocationItem & {
  share: number
  x: number
  y: number
  width: number
  height: number
}

type WeightedItem = AllocationItem & { area: number; share: number }
type WeightedTile = WeightedItem & { x: number; y: number; width: number; height: number }
type Rect = { x: number; y: number; width: number; height: number }

/** 占比不把非零的小额四舍五入成 0%，也不把接近满仓的数提前写成 100%。 */
export function allocationPercent(share: number) {
  if (share === 0) return '0%'
  const sign = share < 0 ? '−' : ''
  const magnitude = Math.abs(share)
  if (magnitude < 0.0001) return `${sign}<0.01%`
  if (magnitude < 1 && magnitude > 0.9999) return `${sign}>99.99%`
  return `${sign}${(magnitude * 100).toFixed(magnitude < 0.01 || magnitude > 0.999 ? 2 : 1)}%`
}

function worstAspect(row: WeightedItem[], side: number) {
  if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY
  const total = row.reduce((sum, item) => sum + item.area, 0)
  const largest = Math.max(...row.map((item) => item.area))
  const smallest = Math.min(...row.map((item) => item.area))
  const sideSquared = side * side
  const totalSquared = total * total
  return Math.max(sideSquared * largest / totalSquared, totalSquared / (sideSquared * smallest))
}

function placeRow(row: WeightedItem[], remaining: Rect): { tiles: WeightedTile[]; rest: Rect } {
  const area = row.reduce((sum, item) => sum + item.area, 0)
  if (remaining.width >= remaining.height) {
    const width = area / remaining.height
    let y = remaining.y
    const tiles = row.map((item, index) => {
      const height = index === row.length - 1 ? remaining.y + remaining.height - y : item.area / width
      const tile = { ...item, x: remaining.x, y, width, height }
      y += height
      return tile
    })
    return {
      tiles,
      rest: { x: remaining.x + width, y: remaining.y, width: Math.max(0, remaining.width - width), height: remaining.height },
    }
  }
  const height = area / remaining.width
  let x = remaining.x
  const tiles = row.map((item, index) => {
    const width = index === row.length - 1 ? remaining.x + remaining.width - x : item.area / height
    const tile = { ...item, x, y: remaining.y, width, height }
    x += width
    return tile
  })
  return {
    tiles,
    rest: { x: remaining.x, y: remaining.y + height, width: remaining.width, height: Math.max(0, remaining.height - height) },
  }
}

/**
 * 用面积而不是扇区角度表达多头占比。Squarified treemap 会尽量得到接近方形的区域，
 * 让窄屏上的小仓位仍有空间同时显示 logo、代码、金额和占比。
 */
export function allocationTiles(items: AllocationItem[], width: number, height: number): AllocationTile[] {
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  const total = valid.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []
  const weighted: WeightedItem[] = valid.map((item) => ({
    ...item,
    share: item.value / total,
    area: item.value / total * width * height,
  }))
  const tiles: WeightedTile[] = []
  let remaining: Rect = { x: 0, y: 0, width, height }
  let row: WeightedItem[] = []
  while (weighted.length > 0) {
    const next = weighted[0]
    const side = Math.min(remaining.width, remaining.height)
    if (row.length === 0 || worstAspect([...row, next], side) <= worstAspect(row, side)) {
      row.push(weighted.shift()!)
      continue
    }
    const placed = placeRow(row, remaining)
    tiles.push(...placed.tiles)
    remaining = placed.rest
    row = []
  }
  if (row.length > 0) tiles.push(...placeRow(row, remaining).tiles)
  return tiles.map((tile) => ({
    key: tile.key,
    value: tile.value,
    color: tile.color,
    share: tile.share,
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
  }))
}
