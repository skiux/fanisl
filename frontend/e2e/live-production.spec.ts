import { expect, test } from '@playwright/test'

test.skip(!process.env.FANISL_LIVE_TEST, '仅在显式启用且真实知识 API 可用时运行。')

test('production build reaches real same-origin data without console errors', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const response = await request.get('/knowledge/overview')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('application/json')
  const overview = await response.json() as { contents: number; nodes: number; units: number }
  expect(overview.contents).toBeGreaterThan(0)
  expect(overview.nodes).toBeGreaterThan(0)
  expect(overview.units).toBeGreaterThan(0)

  for (const hash of ['#/', '#/knowledge', '#/verification', '#/discovery', '#/archive']) {
    await page.goto(`/${hash}`)
    await expect(page.getByText('当前页面没有正确载入')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }

  await page.goto('/#/')
  await page.getByRole('button', { name: '搜索知识' }).click()
  await page.getByRole('textbox', { name: '搜索知识库' }).fill('半导体')
  await expect(page.locator('.search-panel > button').filter({ has: page.locator('.search-result-copy') }).first()).toBeVisible()
  expect(errors).toEqual([])
})
