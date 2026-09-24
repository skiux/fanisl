import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './api-fixture'

// 验证页：上面判决时间轴，下面一屏卡片是它的放大镜，整页不滚动；记录在浮层里看。
// 数据见 api-fixture.ts 的 verificationBuckets；夹具的"今天"是 FIXTURE_NOW（2026-09-01）。

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

const card = (page: Page, text: string | RegExp) => page.locator('.verify-card', { hasText: text })
const dialog = (page: Page) => page.getByRole('dialog', { name: /记录/ })
const ladder = (page: Page) => dialog(page).getByRole('navigation', { name: '评分时点' })
const windowTitle = (page: Page) => page.getByRole('region', { name: '这一段的判断' }).getByRole('heading')
const timeline = (page: Page) => page.getByRole('group', { name: /到期日时间轴/ })
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

test('默认停在截至今天的最近一屏裁决，时间轴与卡片都在一屏里', async ({ page }) => {
  await page.goto('/#/verification')
  await expect(timeline(page)).toBeVisible()
  // 窗口的最后一张正好是今天以前最近的一条结果（08/25 部分命中），一屏放几张随视口变
  await expect(card(page, '黄金 3900 是长期支撑')).toBeVisible()
  await expect(windowTitle(page)).toContainText('08/25')
  await expect(page.locator('.verify-card').last()).toContainText('黄金 3900 是长期支撑')
  await expect(page.locator('.verify-timeline-lens')).toHaveCount(1)
  await expect.poll(() => pageScroll(page)).toBeLessThanOrEqual(0)
})

test('点开一条裁决：浮层里有判定标准、实测与价格图，关掉后地址回到那一段', async ({ page }) => {
  await page.goto('/#/verification?day=2026-08-20')
  await card(page, /未中.*半导体这一段还没走完/).click()
  await expect(page).toHaveURL(/#\/verification\?score=502$/)
  await expect(dialog(page).getByText('至阶梯日 SOXX 任一日最高价 ≥ 262 = hit')).toBeVisible()
  await expect(dialog(page).getByText('241.5', { exact: true })).toBeVisible()
  await expect(dialog(page).getByRole('img', { name: 'SOXX 价格走势' })).toBeVisible()
  await expect(ladder(page).getByRole('button', { name: /08\/20 未中/ })).toHaveAttribute('aria-current', 'true')

  await ladder(page).getByRole('button', { name: /08\/10 命中/ }).click()
  await expect(page).toHaveURL(/score=501$/)
  await expect(dialog(page).getByText('262.4', { exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(page).toHaveURL(/#\/verification\?day=2026-08-\d\d$/)
  await expect.poll(() => pageScroll(page)).toBeLessThanOrEqual(0)
})

test('「更晚」沿时间轴翻过今天，放大镜跟着右移', async ({ page }) => {
  await page.goto('/#/verification')
  const lensX = () => page.locator('.verify-timeline-lens').evaluate((element) => Number(element.getAttribute('x')))
  const before = await lensX()
  await page.getByRole('navigation', { name: '沿时间轴翻看' }).getByRole('button', { name: '更晚 ›' }).click()
  await expect(card(page, /填充判断/).first()).toBeVisible()
  await expect(page.locator('.verify-card.kind-due').first()).toBeVisible()
  expect(await lensX()).toBeGreaterThan(before)
  await expect.poll(() => pageScroll(page)).toBeLessThanOrEqual(0)
})

test('时间轴上用方向键前后移一天；?day= 深链落在那一天', async ({ page }) => {
  await page.goto('/#/verification?day=2026-08-10')
  await expect(windowTitle(page)).toContainText(/^08\/10/)
  await timeline(page).focus()
  await page.keyboard.press('ArrowRight')
  await expect(windowTitle(page)).toContainText(/^08\/12/)
  await expect(page).toHaveURL(/day=2026-08-12$/)

  await page.goto('/#/verification?day=2026-09-05')
  await expect(windowTitle(page)).toContainText(/^09\/05/)
})

test('点图例隐去一类，时间轴和卡片一起变', async ({ page }) => {
  await page.goto('/#/verification')
  const legend = page.getByRole('group', { name: '按类别显示' })
  await expect(page.locator('.tl-due').first()).toBeVisible()
  await legend.getByRole('button', { name: /即将到期/ }).click()
  await expect(legend.getByRole('button', { name: /即将到期/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.tl-due')).toHaveCount(0)
  await expect(page.locator('.verify-card.kind-due')).toHaveCount(0)
  await expect(card(page, '黄金 3900 是长期支撑')).toBeVisible()
})

test('搜索筛空后可以一键清除', async ({ page }) => {
  await page.goto('/#/verification')
  await page.getByRole('searchbox', { name: '搜索验证记录' }).fill('黄金')
  await expect(page.locator('.verify-card')).toHaveCount(1)
  await page.getByRole('searchbox', { name: '搜索验证记录' }).fill('不存在的词')
  await expect(page.getByText('没有匹配的记录')).toBeVisible()
  await page.getByRole('button', { name: '清除条件' }).click()
  await expect(card(page, '黄金 3900 是长期支撑')).toBeVisible()
})

test('深链打开浮层，背后的卡片窗口移到那一条', async ({ page }) => {
  await page.goto('/#/verification?score=504')
  await expect(dialog(page).getByText('SOXX 先回踩 230', { exact: true })).toBeVisible()
  await expect(card(page, '回踩 230 之后再看 262')).toHaveAttribute('aria-current', 'true')
})

test('评分阶梯上点未到期的时点：浮层换成那一条，窗口移到十月', async ({ page }) => {
  await page.goto('/#/verification?score=501')
  await ladder(page).getByRole('button', { name: /10\/01/ }).click()
  await expect(page).toHaveURL(/due=1&horizon=2026-10-01$/)
  await expect(dialog(page).getByText('发布参考价')).toBeVisible()
  await expect(dialog(page).getByRole('img', { name: /价格走势/ })).toHaveCount(0)
  await expect(page.locator('.verify-card.kind-due[aria-current="true"]')).toContainText('10/01')
})

test('浮层里 ← → 逐条看，窗口跟着走', async ({ page }) => {
  await page.goto('/#/verification?score=503')
  const counter = dialog(page).getByRole('navigation', { name: '逐条查看' })
  const position = Number((await counter.textContent())?.match(/(\d+) \//)?.[1])
  await page.keyboard.press('ArrowRight')
  await expect(counter).toContainText(`${position + 1} /`)
  await expect(page).toHaveURL(/due=6&horizon=2026-09-03$/)
  await expect(page.locator('.verify-card[aria-current="true"]')).toContainText('纳指这里回踩就是买点')
})

test('分档判界按这次的阶梯日取值，定级说明跟在标的说明之后', async ({ page }) => {
  await page.goto('/#/verification?score=503')
  await expect(dialog(page).locator('header')).toContainText('下界 3900')
  await expect(dialog(page).getByRole('img', { name: 'XAUUSD 价格走势' })).toContainText('下界 3900')
  await dialog(page).getByText('更多判据信息').click()
  const facts = dialog(page).locator('.verify-body-more dt')
  await expect(facts.filter({ hasText: '定级说明' })).toBeVisible()
  const labels = await facts.allTextContents()
  expect(labels.indexOf('定级说明')).toBe(labels.indexOf('标的说明') + 1)
})

test('不可判的记录说明原因，不画价格', async ({ page }) => {
  await page.goto('/#/verification?score=505')
  await expect(dialog(page).getByText("无符号映射: ['FCG']")).toBeVisible()
  await expect(dialog(page).getByRole('img', { name: /价格走势/ })).toHaveCount(0)
})

test('证据单元叠在记录浮层之上，关掉后记录浮层还在', async ({ page }) => {
  await page.goto('/#/verification?score=502')
  await dialog(page).getByRole('button', { name: '证据单元 →' }).click()
  const evidence = page.getByRole('dialog', { name: '证据单元 1' })
  await expect(evidence).toBeVisible()
  await evidence.getByRole('button', { name: /返回验证记录/ }).click()
  await expect(evidence).toHaveCount(0)
  await expect(dialog(page)).toBeVisible()
})
