import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFund, buildSnapshot } from '../../api/fixtures'
import type { FundSnapshot } from '../../api/types'
import { money } from '../../lib/format'
import { AccountsStrip, AccountsView, accountsModel } from './Accounts'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const at = new Date('2026-10-02T12:00:00Z')
const snapshot = buildSnapshot(at)

function render(fund: FundSnapshot, admin: boolean, selected = fund.members[0]?.user_id ?? null) {
  const model = accountsModel(snapshot, fund)
  const account = model.accounts.find((row) => row.member.user_id === selected) ?? model.accounts[0] ?? null
  const onSelect = vi.fn()
  act(() => root.render(createElement('div', null,
    createElement(AccountsStrip, { account, atMs: model.atMs, fund, snapshot }),
    createElement(AccountsView, { account, admin, fund, model, onSelect, snapshot }),
  )))
  return { model, onSelect }
}

describe('资产页「账户」', () => {
  it('管理员看得到全部账户的列表，点一行就切到那个人', () => {
    const fund = buildFund(at)
    const { model, onSelect } = render(fund, true)
    const bob = model.accounts[1]
    expect(host.textContent).toContain('Bob')
    expect(host.textContent).toContain(money(bob.value))

    const row = [...host.querySelectorAll('button[aria-pressed]')]
      .find((button) => button.textContent?.includes('Bob'))!
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith(bob.member.user_id)
  })

  it('摘要条与「分配」说的是同一个人；Investor 没有 Manager 的两项', () => {
    const fund = buildFund(at)
    const { model } = render(fund, true, 3)
    const bob = model.accounts.find((row) => row.member.user_id === 3)!
    expect(host.textContent).toContain(money(bob.value))
    expect(host.textContent).toContain('Investor Return')
    expect(host.textContent).not.toContain('Performance Fee')
  })

  it('成员只拿到自己那一行：没有账户列表', () => {
    const fund = buildFund(at)
    render({ ...fund, members: fund.members.slice(1) }, false)
    const titles = [...host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(titles).not.toContain('账户')
    // 右栏标题就是这个人，不再写「分配」「可分配」；基数那几行用基金的英文说法
    expect(titles).toContain('Bob')
    expect(titles).not.toContain('分配')
    expect(titles).not.toContain('可分配')
    for (const label of ['Initial NAV', 'Current NAV', 'Gross P&L', 'Management Fee', 'Net P&L', 'Inception Date']) {
      expect(host.textContent).toContain(label)
    }
  })

  it('还没有参与者：管理员看到去「用户」的入口', () => {
    render({ ...buildFund(at), members: [] }, true)
    expect(host.textContent).toContain('还没有参与分配的用户')
    expect(host.querySelector('a[href="#/admin"]')).not.toBeNull()
  })
})
