import { describe, expect, it } from 'vitest'
import { allocationPercent, ringPath, sliceLayout } from './donut'

describe('环图几何', () => {
  it('保留长尾的真实角度且总和闭合一圈', () => {
    const values = [9850, 100, 25, 12, 6, 4, 2, 0.9, 0.1]
    const slices = sliceLayout(values.map((value, index) => ({ key: String(index), value, color: 'blue' })))
    expect(slices).toHaveLength(values.length)
    for (const slice of slices) {
      expect(slice.end - slice.start).toBeCloseTo(slice.value / 10000 * Math.PI * 2, 10)
    }
    expect(slices.at(-1)!.end - slices[0].start).toBeCloseTo(Math.PI * 2, 12)
  })

  it('超过半圈用长弧，满圈用两个半圆，空数据不产生无效路径', () => {
    expect(ringPath(170, 90, 150, 0, Math.PI * 1.7)).toContain('0 1 1')
    expect(ringPath(170, 90, 150, 0, Math.PI * 2).match(/A150,150/g)).toHaveLength(2)
    expect(sliceLayout([])).toEqual([])
    expect(sliceLayout([{ key: 'invalid', value: NaN, color: 'blue' }, { key: 'zero', value: 0, color: 'blue' }])).toEqual([])
  })

  it('很小的非零占比与接近满仓都有明确的显示精度', () => {
    expect(allocationPercent(0)).toBe('0%')
    expect(allocationPercent(0.000001)).toBe('<0.01%')
    expect(allocationPercent(0.0019)).toBe('0.19%')
    expect(allocationPercent(0.99995)).toBe('>99.99%')
    expect(allocationPercent(1)).toBe('100.00%')
  })
})
