import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BottomNavigation } from './BottomNavigation'

describe('desktop bottom navigation', () => {
  it('links all five destinations and marks only the current one', () => {
    const html = renderToStaticMarkup(createElement(BottomNavigation, { current: 'perp' }))
    const host = document.createElement('div')
    host.innerHTML = html
    const links = [...host.querySelectorAll('nav[aria-label="资产主导航"] a')]
    expect(links.map((link) => link.textContent)).toEqual(['资产', '流水', '持仓', '合约', '风险'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/assets/overview', '#/ledger', '#/assets/holdings', '#/assets/perp', '#/assets/risk',
    ])
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page'))
      .toEqual([links[3]])
  })

  it('「用户」只给管理员，排在最后', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(BottomNavigation, { current: 'users', admin: true }))
    const links = [...host.querySelectorAll('nav a')]
    expect(links.map((link) => link.textContent)).toEqual(['资产', '流水', '持仓', '合约', '风险', '用户'])
    expect(links[5].getAttribute('href')).toBe('#/admin')
    expect(links[5].getAttribute('aria-current')).toBe('page')
  })
})
