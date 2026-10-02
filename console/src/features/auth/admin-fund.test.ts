import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFund } from '../../api/fixtures'
import { refreshSession, type User } from '../../api/session'
import { AdminPage } from './AdminPage'

let host: HTMLDivElement
let root: Root
let puts: { url: string; body: unknown }[]

const user = (id: number, username: string, role: User['role']): User => ({
  id, username, role, display_name: username, is_active: true,
  created_at: null, updated_at: null, last_login_at: null, last_seen_at: null,
})
const USERS = [user(1, 'boss', 'admin'), user(2, 'alice', 'member'), user(3, 'bob', 'member')]

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
})

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  puts = []
  const fund = buildFund(new Date('2026-10-02T12:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      puts.push({ url: url.slice(url.indexOf('/admin')), body: JSON.parse(String(init.body)) })
      return json({ member: null })
    }
    if (url.includes('/auth/me')) return json({ user: USERS[0] })
    if (url.includes('/admin/users')) return json(USERS)
    if (url.includes('/portfolio/fund')) return json(fund)
    return new Response('{}', { status: 404 })
  }))
  await refreshSession()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

const button = (label: string, within: ParentNode = host) =>
  [...within.querySelectorAll('button')].find((node) => node.textContent === label)!

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('用户页的分配', () => {
  it('管理员那一行没有「分配」；成员的比例按百分数录入、按小数提交', async () => {
    act(() => root.render(createElement(AdminPage)))
    await settle()

    const rows = [...host.querySelectorAll('li')]
    const boss = rows.find((row) => row.textContent?.includes('boss'))!
    expect(boss.textContent).not.toContain('分配')

    const bob = rows.find((row) => row.textContent?.includes('bob'))!
    act(() => button('分配', bob).click())
    type(bob.querySelector<HTMLInputElement>('input[id$="-capital"]')!, '40000')
    type(bob.querySelector<HTMLInputElement>('input[id$="-investor_return"]')!, '62.5')
    await act(async () => {
      bob.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()

    expect(puts).toEqual([{ url: '/admin/fund/members/3', body: {
      is_manager: false, is_investor: true, invested_capital_usd: 40000,
      loss_allocation: 0, management_fee: 0, performance_fee: 0, investor_return: 0.625,
    } }])
  })

  it('账户一块：录了初始净值没填起始日，按当天算', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T08:00:00Z'))
    act(() => root.render(createElement(AdminPage)))
    await settle()

    type(host.querySelector<HTMLInputElement>('#fund-inception')!, '')
    await act(async () => {
      host.querySelector('#fund-initial')!.closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
    vi.useRealTimers()

    expect(puts).toEqual([{ url: '/admin/fund', body: {
      initial_nav_usd: 72000, inception_date: '2026-10-03', cash_usd: 3000,
    } }])
  })
})
