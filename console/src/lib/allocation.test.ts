import { describe, expect, it } from 'vitest'
import { allocationPercent, allocationSlices, ringPath } from './allocation'

describe('allocationSlices', () => {
  it('每个扇区角度严格对应金额占比，全部扇区闭合为一整圈', () => {
    const values = [18.3, 16.7, 15, 9.2, 8, 7, 5.8, 5, 4.3, 3.8, 3.5, 3.3]
    const slices = allocationSlices(values.map((value, index) => ({ key: String(index), value, color: 'blue' })))
    expect(slices).toHaveLength(values.length)
    const total = values.reduce((sum, value) => sum + value, 0)
    expect(slices[0].start).toBeCloseTo(-Math.PI / 2, 12)
    expect(slices.at(-1)!.end).toBeCloseTo(Math.PI * 1.5, 12)
    for (const slice of slices) {
      expect((slice.end - slice.start) / (Math.PI * 2))
        .toBeCloseTo(slice.value / total, 12)
    }
  })

  it('布局是确定的，并过滤无效金额', () => {
    const items = [
      { key: 'valid', value: 1, color: 'blue' },
      { key: 'invalid', value: Number.NaN, color: 'blue' },
      { key: 'zero', value: 0, color: 'blue' },
    ]
    expect(allocationSlices(items).map((slice) => slice.key)).toEqual(['valid'])
    expect(allocationSlices(items)).toEqual(allocationSlices(items))
    expect(allocationSlices([])).toEqual([])
  })

  it('单资产满圈仍产生有效的双圆弧路径', () => {
    const path = ringPath(100, 30, 90, -Math.PI / 2, Math.PI * 1.5)
    expect(path.match(/ A/g)).toHaveLength(4)
    expect(path).not.toContain('NaN')
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
