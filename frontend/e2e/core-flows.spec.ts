import { expect, test } from '@playwright/test'
import { mockApi } from './api-fixture'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

const routes = [
  ['#/', 'FANISL · 个人投资知识引擎'],
  ['#/asset', '标的 · FANISL'],
  ['#/knowledge', '知识库 · FANISL'],
  ['#/verification', '验证中心 · FANISL'],
  ['#/discovery', '发现 · FANISL'],
  ['#/archive', '研究档案 · FANISL'],
] as const

for (const [hash, title] of routes) {
  test(`${hash} renders without overflow or route failure`, async ({ page }) => {
    await page.goto(`/${hash}`)
    await expect(page).toHaveTitle(title)
    await expect(page.getByText('当前页面没有正确载入')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
}

test('search modal traps focus, returns it, and opens a real result', async ({ page }) => {
  await page.goto('/#/')
  const trigger = page.getByRole('button', { name: '搜索知识' })
  await trigger.click()
  const input = page.getByRole('textbox', { name: '搜索知识库' })
  await expect(input).toBeFocused()
  await input.fill('半导体')
  await expect(page.getByRole('button', { name: /半导体研究样本/ })).toBeVisible()
  await page.locator('.search-panel > button').last().press('Tab')
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('content close uses history and forward reopens the record', async ({ page }) => {
  await page.goto('/#/knowledge')
  await page.getByRole('button', { name: '半导体研究样本', exact: true }).click()
  await expect(page).toHaveURL(/content=1/)
  await page.getByRole('button', { name: '← 返回原始内容' }).click()
  await expect(page).toHaveURL(/#\/knowledge$/)
  await page.goForward()
  await expect(page).toHaveURL(/content=1/)
  await expect(page.getByRole('heading', { name: '半导体研究样本' })).toBeVisible()
})

test('evidence tabs support arrow keys', async ({ page }) => {
  await page.goto('/#/knowledge?view=evidence')
  await page.getByRole('button', { name: /半导体长期需求/ }).click()
  const first = page.getByRole('tab', { name: /结构化结论/ })
  await first.focus()
  await first.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /市场裁决/ })).toHaveAttribute('aria-selected', 'true')
})

test('unit filter rail counts units, not sources', async ({ page }) => {
  await page.goto('/#/knowledge?view=evidence')
  await expect(page.locator('.unit-row').first()).toBeVisible()
  const filterToggle = page.getByRole('button', { name: /^筛选/ })
  if (await filterToggle.isVisible()) await filterToggle.click() // 窄屏下筛选栏是抽屉
  const allSources = page.getByRole('button', { name: /^全部信源/ })
  await expect(allSources).toBeVisible()
  // 这一列全是单元数；“全部信源”曾经错显示成信源个数（1），与同列的 120 对不上。
  await expect(allSources.locator('b')).toHaveText('120')
})

test('scrolling through a page boundary keeps loading, even while still scrolling', async ({ page }) => {
  await page.goto('/#/knowledge?view=evidence')
  const list = page.locator('.unit-list')
  await expect(page.locator('.unit-row').first()).toBeVisible()

  const lastRenderedIndex = () => page.evaluate(() => Math.max(
    -1,
    ...[...document.querySelectorAll<HTMLElement>('.unit-row')].map((row) => Number(row.dataset.index)),
  ))

  // 持续增量滚动：翻页请求发出后 scrollTop 仍在变，lastVirtualIndex 跟着变，
  // 正是它自己把自己 abort 掉的那个时序。贴底不动是复现不出来的。
  for (let step = 0; step < 90; step += 1) {
    await list.evaluate((node) => { node.scrollTop += 300 })
    await page.waitForTimeout(35)
  }

  // 停止滚动后再往下走：修好了就能读到第二页，没修好则永远停在第 99 条。
  await expect.poll(async () => {
    await list.evaluate((node) => { node.scrollTop += 600 })
    return lastRenderedIndex()
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(100)
  await expect(page.locator('.unit-load-retry')).toHaveCount(0)
})

test('discovery delta is modal and restores focus', async ({ page }) => {
  await page.goto('/#/discovery')
  const trigger = page.getByRole('button', { name: /本期变化/ })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '本期知识变化' })
  await expect(dialog).toBeVisible()
  await expect(page.locator('[inert]')).not.toHaveCount(0)
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('asset desk leads with what has not settled yet', async ({ page }) => {
  await page.goto('/#/asset')
  await expect(page.getByRole('heading', { name: '标的' })).toBeVisible()

  // 没有到期样本的标的写"未验证"，不写 0%——这是 domain-model §5 的统计纪律。
  await expect(page.getByText('未验证')).toBeVisible()
  await expect(page.getByText('0%')).toHaveCount(0)

  await page.getByText('半导体 ETF', { exact: true }).click()
  await expect(page).toHaveURL(/#\/asset\?id=SOXX/)

  // 未到期判断是这一页的主角：判据原文必须完整可见，不许截断。
  await expect(page.getByText('中期收益为正')).toBeVisible()
  await expect(page.getByText('n = 27')).toBeVisible()

  // 覆盖条如实说明缺什么。
  await expect(page.getByText(/公司资料源落地/)).toBeVisible()

  // 价格证据图把已发生的裁决与还没到期的阶梯日放在同一条时间轴上。
  await expect(page.getByRole('img', { name: /价格证据图/ })).toBeVisible()
  await expect(page.getByText(/待到期 1 个时点/)).toBeVisible()
})

test('asset dossier keeps the drill-down chain into the evidence', async ({ page }) => {
  await page.goto('/#/asset?id=SOXX')
  // 节点卡片的 canonical 与这条判断同文，所以按分区取——顺带验证分区的可访问名。
  await page.locator('section[aria-label="未到期判断"]').getByRole('link').first().click()
  await expect(page).toHaveURL(/#\/knowledge\?unit=1&view=evidence/)
  await expect(page.getByText('当前页面没有正确载入')).toHaveCount(0)
})

test('unknown asset fails into a recoverable state, not a blank page', async ({ page }) => {
  await page.goto('/#/asset?id=NOSUCH')
  await expect(page.getByText(/读不到 NOSUCH 的档案/)).toBeVisible()
  await page.getByRole('button', { name: '回到标的列表' }).click()
  await expect(page).toHaveURL(/#\/asset$/)
})
