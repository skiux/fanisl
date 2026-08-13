import { describe, expect, it } from 'vitest'
import { routeFromHash, titleForRoute } from './route'

describe('hash routes', () => {
  it('keeps detail and query strings inside their owning workspace', () => {
    expect(routeFromHash('#/knowledge?content=42')).toBe('knowledge')
    expect(routeFromHash('#/verification?score=8')).toBe('verification')
    expect(routeFromHash('#/discovery?view=relations')).toBe('discovery')
    expect(routeFromHash('#/archive?doc=capstone')).toBe('archive')
  })

  it('falls back to home for unknown and empty hashes', () => {
    expect(routeFromHash('')).toBe('home')
    expect(routeFromHash('#/unknown')).toBe('home')
    expect(titleForRoute('home')).toBe('FANISL · 个人投资知识引擎')
  })
})
