import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function BrokenRoute(): never {
  throw new Error('route failed')
}

describe('ErrorBoundary', () => {
  it('replaces a render failure with a recovery surface', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><BrokenRoute /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('当前页面没有正确载入')
    expect(screen.getByRole('button', { name: '重新载入' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('#/')
  })
})
