import { expect, test } from '@playwright/test'
import { mockApi, mockAuth } from './api-fixture'

test('未登录时只渲染登录页，应用本体一行都不挂载', async ({ page }) => {
  await mockAuth(page, null)
  await page.goto('/#/knowledge')

  await expect(page.getByRole('heading', { name: '个人投资知识引擎' })).toBeVisible()
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
  await page.getByRole('button', { name: '进入' }).click()

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
  await page.getByRole('button', { name: '进入' }).click()
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
  await expect(page.getByRole('heading', { name: '个人投资知识引擎' })).toBeVisible()

  await page.getByRole('textbox', { name: '用户名' }).fill('alice')
  await page.getByLabel('口令').fill('correct-password')
  await page.getByRole('button', { name: '进入' }).click()

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

  await expect(page.getByRole('heading', { name: '个人投资知识引擎' })).toBeVisible()
})

test('账号菜单：一个入口装下身份、账号、用户管理与退出', async ({ page }) => {
  // 原来是往顶栏直接排三个文字元素，把 .nav-actions（没有 gap 的 flex）撑到裁字。
  // 现在收成一个触发器 + 一个面板。
  await mockApi(page)
  await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true }, status: 200 }))
  await page.goto('/#/knowledge')

  const trigger = page.getByRole('button', { name: /测试用户/ })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()

  const menu = page.getByRole('menu')
  await expect(menu).toContainText('测试用户')
  await expect(menu.getByRole('menuitem', { name: '账号与口令' })).toBeVisible()
  await menu.getByRole('menuitem', { name: '退出' }).click()
  await expect(page.getByRole('heading', { name: '个人投资知识引擎' })).toBeVisible()
})

test('账号菜单可用 Escape 关闭，焦点回到触发器', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge')

  const trigger = page.getByRole('button', { name: /测试用户/ })
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  // 键盘用户不该在菜单关掉之后掉进虚空
  await expect(trigger).toBeFocused()
})

test('顶栏有去资产台的入口，且不把用户名挤到裁字', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge')

  // 窄屏下导航整组折在汉堡菜单里——不先展开，链接根本不可见。
  // **先等顶栏渲染出来**：isVisible() 是即时检查，React 还没渲染时它返回 false，
  // 于是汉堡没被点开、链接找不到，报错却指向链接那一行。
  // （同样的坑在筛选栏那条测试上踩过一次，这里又踩了一次。）
  await expect(page.locator('.spatial-nav')).toBeVisible()
  const hamburger = page.locator('.menu-trigger')
  if (await hamburger.isVisible()) await hamburger.click()
  await expect(page.getByRole('link', { name: '资产' })).toHaveAttribute('href', '/console/')

  // .nav-actions 原来没有 gap：多一个元素就会顶在一起，把用户名裁掉
  const overflow = await page.locator('.spatial-nav').evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1)
  expect(overflow).toBe(false)
})

test('显示名很长也不撑破顶栏', async ({ page }) => {
  // 窄屏顶栏本来就是刚好排满的，这种问题只在"某个人名字比较长"时才出现
  await mockApi(page, { display_name: '一个相当长的显示名字用来测试布局' })
  await page.goto('/#/knowledge')

  await expect(page.getByRole('button', { name: /相当长/ })).toBeVisible()
  const overflow = await page.locator('.spatial-nav').evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1)
  expect(overflow).toBe(false)
})
