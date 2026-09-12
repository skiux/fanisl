import { describe, expect, it } from 'vitest'
import { allocationPercent, allocationTiles } from './allocation'

describe('allocationTiles', () => {
  it('每块面积严格对应金额占比且区域不重叠', () => {
    const width = 560
    const height = 560
    const values = [18.3, 16.7, 15, 9.2, 8, 7, 5.8, 5, 4.3, 3.8, 3.5, 3.3]
    const tiles = allocationTiles(values.map((value, index) => ({ key: String(index), value, color: 'blue' })), width, height)
    expect(tiles).toHaveLength(values.length)
    const total = values.reduce((sum, value) => sum + value, 0)
    for (let first = 0; first < tiles.length; first += 1) {
      const tile = tiles[first]
      expect(tile.width * tile.height / (width * height)).toBeCloseTo(tile.value / total, 10)
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.y).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.width).toBeLessThanOrEqual(width + 1e-8)
      expect(tile.y + tile.height).toBeLessThanOrEqual(height + 1e-8)
      for (let second = first + 1; second < tiles.length; second += 1) {
        const other = tiles[second]
        expect(tile.x + tile.width <= other.x + 1e-8
          || other.x + other.width <= tile.x + 1e-8
          || tile.y + tile.height <= other.y + 1e-8
          || other.y + other.height <= tile.y + 1e-8).toBe(true)
      }
    }
  })

  it('过滤无效金额并处理空尺寸', () => {
    const items = [
      { key: 'valid', value: 1, color: 'blue' },
      { key: 'invalid', value: Number.NaN, color: 'blue' },
      { key: 'zero', value: 0, color: 'blue' },
    ]
    expect(allocationTiles(items, 100, 100).map((tile) => tile.key)).toEqual(['valid'])
    expect(allocationTiles(items, 0, 100)).toEqual([])
    expect(allocationTiles([], 100, 100)).toEqual([])
  })
})

describe('allocationPercent', () => {
  it('为很小但非零的份额保留含义', () => {
    expect(allocationPercent(0)).toBe('0%')
    expect(allocationPercent(0.000001)).toBe('<0.01%')
    expect(allocationPercent(0.0019)).toBe('0.19%')
    expect(allocationPercent(-0.2)).toBe('−20.0%')
    expect(allocationPercent(-0.000001)).toBe('−<0.01%')
    expect(allocationPercent(0.99995)).toBe('>99.99%')
    expect(allocationPercent(1)).toBe('100.00%')
  })
})
