import { expect, test } from '@playwright/test'
import { mockApi, mockAuth } from './api-fixture'

test('未登录时只渲染登录页，应用本体一行都不挂载', async ({ page }) => {
  await mockAuth(page, null)
  await page.goto('/#/knowledge')

  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  // 闸门是默认关的：不是"渲染应用再各处判断"，那样漏一个页面就是一屏报错
  await expect(page.locator('.spatial-nav')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '用户名' })).toBeFocused()
})

test('口令错误显示后端原话，不猜是用户名还是口令', async ({ page }) => {
  await mockAuth(page, null)
  await page.route('**/auth/login', (route) => route.fulfill({
    json: { detail: '用户名或口令不正确' }, status: 401,
  }))
  await page.goto('/#/')

  await page.getByRole('textbox', { name: '用户名' }).fill('alice')
  await page.getByLabel('口令').fill('wrong')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByRole('alert')).toHaveText('用户名或口令不正确')
  // 口令被清空，用户名保留——重试时不用两个都重新输
  await expect(page.getByLabel('口令')).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '用户名' })).toHaveValue('alice')
})

test('被限速时把后端那句话原样显示', async ({ page }) => {
  await mockAuth(page, null)
  await page.route('**/auth/login', (route) => route.fulfill({
    json: { detail: '失败次数过多，请 15 分钟后再试' }, status: 429,
  }))
  await page.goto('/#/')

  await page.getByRole('textbox', { name: '用户名' }).fill('alice')
  await page.getByLabel('口令').fill('x')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('15 分钟')
})

test('登录成功后停在原来那一页，不被踢回首页', async ({ page }) => {
  await mockApi(page)
  await page.unroute('**/auth/me')
  let loggedIn = false
  await page.route('**/auth/me', (route) => (loggedIn
    ? route.fulfill({ json: { user: { id: 1, username: 'alice', role: 'member',
        display_name: '爱丽丝', is_active: true, last_login_at: null } }, status: 200 })
    : route.fulfill({ json: { detail: '未登录' }, status: 401 })))
  await page.route('**/auth/login', (route) => {
    loggedIn = true
    return route.fulfill({ json: { user: { id: 1, username: 'alice', role: 'member',
      display_name: '爱丽丝', is_active: true, last_login_at: null } }, status: 200 })
  })

  await page.goto('/#/knowledge')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()

  await page.getByRole('textbox', { name: '用户名' }).fill('alice')
  await page.getByLabel('口令').fill('correct-password')
  await page.getByRole('button', { name: '登录' }).click()

  // 地址栏的 hash 从头到尾没动过，所以登录后落在知识库而不是首页
  await expect(page).toHaveURL(/#\/knowledge$/)
  await expect(page.locator('.spatial-nav')).toBeVisible()
})

test('会话中途失效：任意接口 401 就整体切回登录页', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge')
  await expect(page.locator('.spatial-nav')).toBeVisible()

  // 模拟会话过期 / 被管理员踢掉。
  // 匹配必须按 **pathname 前缀**判断：dev server 的模块地址
  // `/src/features/knowledge/KnowledgePage.tsx` 里也含 `/knowledge/`，
  // 用宽正则会把它一并拦成 401，页面报的却是"动态导入失败"——
  // 与仓库里记着的 `/asset` vs `/assets` 是同一类错误。
  await page.unroute(/\/knowledge\/|\/research\/|\/asset(\/|$)/)
  await page.route(
    (url) => url.pathname.startsWith('/knowledge/'),
    (route) => route.fulfill({ json: { detail: '未登录或会话已过期' }, status: 401 }),
  )
  await page.reload()

  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
})

test('顶栏显示当前用户并能退出', async ({ page }) => {
  await mockApi(page)
  await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true }, status: 200 }))
  await page.goto('/#/knowledge')

  const chip = page.locator('.nav-user')
  await expect(chip).toContainText('测试用户')
  await chip.getByRole('button', { name: '退出' }).click()
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
})
