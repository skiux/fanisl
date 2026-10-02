import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFund } from '../../api/fixtures'
import { refreshSession, type User } from '../../api/session'
import { clearPageData } from '../../lib/pageData'
import { AdminPage } from './AdminPage'

let host: HTMLDivElement
let root: Root
let puts: { url: string; body: unknown }[]

const user = (id: number, username: string, role: User['role']): User => ({
  id, username, role, display_name: username, is_active: true,
  created_at: null, updated_at: null, last_login_at: null, last_seen_at: null,
})
// 示例账户规则里 alice 是 2、bob 是 3
const USERS = [user(1, 'boss', 'admin'), user(2, 'alice', 'member'), user(3, 'bob', 'member')]

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
})

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  clearPageData()
  puts = []
  const fund = buildFund(new Date('2026-10-02T12:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      puts.push({ url: url.slice(url.indexOf('/admin')), body: JSON.parse(String(init.body)) })
      return json({ member: null, settings: fund.settings })
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
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  })
}

async function render() {
  act(() => root.render(createElement(AdminPage)))
  await settle()
}

const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((node) => node.textContent === label)!
const row = (username: string) => [...host.querySelectorAll('li button')]
  .find((node) => node.textContent?.includes(`${username} ·`)) as HTMLButtonElement
const sheet = () => document.querySelector('[role="dialog"]')!

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()
}

describe('用户页', () => {
  it('页面只放读数：成员列表、账户与分配；分配按 Performance Fee + 出资占比 × Investor Return', async () => {
    await render()
    const titles = [...host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(titles).toEqual(['成员', '账户', '分配'])
    // 页面上没有任何输入框：新建、编辑都在点开的那张纸里
    expect(host.querySelectorAll('input, select').length).toBe(0)

    const share = [...host.querySelectorAll('tr')].map((tr) => tr.textContent)
    // alice：20% + 20,000/72,000 × 80% = 42.2%；bob：52,000/72,000 × 80% = 57.8%
    expect(share.some((text) => text?.includes('alice') && text.includes('42.2%'))).toBe(true)
    expect(share.some((text) => text?.includes('bob') && text.includes('57.8%'))).toBe(true)
  })

  it('管理员那张纸里没有分配；成员的比例按百分数录入、按小数提交', async () => {
    await render()
    act(() => row('boss').click())
    expect(sheet().textContent).not.toContain('Investor')
    act(() => (sheet().querySelector('[aria-label="关闭"]') as HTMLButtonElement).click())
    await settle()

    act(() => row('bob').click())
    const dialog = sheet()
    expect(button('Investor', dialog).getAttribute('aria-pressed')).toBe('true')
    type(dialog.querySelector<HTMLInputElement>('input[id$="-capital"]')!, '40000')
    type(dialog.querySelector<HTMLInputElement>('input[id$="-investor_return"]')!, '62.5')
    // 按现在填的数实时算出这个人分到多少：40,000/72,000 × 62.5% = 34.7%
    expect(dialog.textContent).toContain('34.7%')
    await submit(dialog.querySelector('form')!)

    expect(puts).toEqual([{ url: '/admin/fund/members/3', body: {
      is_manager: false, is_investor: true, invested_capital_usd: 40000,
      loss_allocation: 0, management_fee: 0, performance_fee: 0, investor_return: 0.625,
    } }])
  })

  it('账户那张纸：起始日用滚轮选择器，不是系统的日期框', async () => {
    await render()
    act(() => button('编辑', host).click())
    const dialog = sheet()
    expect(dialog.querySelector('input[type="date"]')).toBeNull()
    expect(dialog.querySelector('#fund-inception')?.textContent).toContain('年')

    type(dialog.querySelector<HTMLInputElement>('#fund-cash')!, '4500')
    await submit(dialog.querySelector('form')!)
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toBe('/admin/fund')
    expect(puts[0].body).toMatchObject({ initial_nav_usd: 72000, cash_usd: 4500 })
  })
})
