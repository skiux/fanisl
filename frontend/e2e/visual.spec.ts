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

test('verification masthead visual baseline', async ({ page }) => {
  await page.goto('/#/verification')
  await expect(page.locator('.verification-masthead')).toHaveScreenshot('verification-masthead.png', {
    animations: 'disabled',
    caret: 'hide',
  })
})
