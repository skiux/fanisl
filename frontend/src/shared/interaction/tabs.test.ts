import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './tabs'

describe('nextTabIndex', () => {
  it('wraps directional navigation and supports Home/End', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2)
    expect(nextTabIndex('Home', 2, 3)).toBe(0)
    expect(nextTabIndex('End', 0, 3)).toBe(2)
  })

  it('ignores unrelated keys and empty lists', () => {
    expect(nextTabIndex('Enter', 1, 3)).toBeNull()
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
