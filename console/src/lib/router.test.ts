import { describe, expect, it } from 'vitest'
import { canView, readRoute, titleOf } from './router'

function goto(hash: string) {
  window.location.hash = hash
}

describe('路由', () => {
  it('成员进不了用户管理，别的页都能进', () => {
    expect(canView('admin', 'member')).toBe(false)
    expect(canView('admin', 'admin')).toBe(true)
    for (const page of ['assets', 'ledger', 'account'] as const) {
      expect(canView(page, 'member')).toBe(true)
      expect(canView(page, 'admin')).toBe(true)
    }
  })

  it('认得各页，认不出的落回资产页', () => {
    // 「委托」页删了，旧地址落到合约页（委托在那里的右栏）
    goto('#/orders')
    expect(readRoute()).toEqual({ page: 'assets', section: 'perp' })
    goto('#/ledger/30')
    expect(readRoute()).toEqual({ page: 'ledger', section: '30' })
    goto('#/nonsense')
    expect(readRoute().page).toBe('assets')
  })

  it('旧的分节地址还认', () => {
    goto('#/holdings')
    expect(readRoute()).toEqual({ page: 'assets', section: 'holdings' })
  })

  it('标签页标题与页面标题一致', () => {
    expect(titleOf('admin')).toBe('用户 · FANISL CONSOLE')
    expect(titleOf('assets', 'accounts')).toBe('账户 · FANISL CONSOLE')
    expect(titleOf('account')).toBe('账号 · FANISL CONSOLE')
    expect(titleOf('ledger')).toBe('流水 · FANISL CONSOLE')
    expect(titleOf('assets', 'perp')).toBe('合约 · FANISL CONSOLE')
    expect(titleOf('assets', 'risk')).toBe('风险 · FANISL CONSOLE')
  })
})
