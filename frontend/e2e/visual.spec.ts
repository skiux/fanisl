import { expect, test } from '@playwright/test'
import { mockApi } from './api-fixture'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('knowledge masthead visual baseline', async ({ page }) => {
  await page.goto('/#/knowledge')
  await expect(page.locator('.source-library-lead')).toHaveScreenshot('knowledge-masthead.png', {
    animations: 'disabled',
    caret: 'hide',
  })
})

test('verification timeline visual baseline', async ({ page }) => {
  await page.goto('/#/verification')
  await expect(page.locator('.verify-card').first()).toBeVisible()
  await expect(page.locator('.verify-stage')).toHaveScreenshot('verification-timeline.png', {
    animations: 'disabled',
    caret: 'hide',
  })
})

test('verification record visual baseline', async ({ page }) => {
  await page.goto('/#/verification?score=502')
  await expect(page.getByRole('img', { name: 'SOXX 价格走势' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '判定记录 502' })).toHaveScreenshot('verification-record.png', {
    animations: 'disabled',
    caret: 'hide',
  })
})

test('asset desk visual baseline', async ({ page }) => {
  await page.goto('/#/asset')
  await expect(page.getByText('接下来要交卷')).toBeVisible()
  await expect(page.locator('.asset-desk')).toHaveScreenshot('asset-desk.png', {
    animations: 'disabled',
    caret: 'hide',
  })
})
