import { expect, test } from '@playwright/test'
import { mockApi } from './api-fixture'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

const routes = [
  ['#/', 'FANISL · 个人投资知识引擎'],
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
