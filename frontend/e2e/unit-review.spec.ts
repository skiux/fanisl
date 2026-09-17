import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './api-fixture'

// 单元核查（docs/plans/active/features/unit-review.md 第 5 节）。写接口只在夹具里跑：
// 本机 API 连的是生产隧道，对它提交就是往生产库里写核查。
// 夹具默认会话是成员（role=member）：核查不分角色，下面的用例都以成员身份跑。

// 桌面上是右栏的阅读区，窄屏是抽屉——两种都在 .unit-reader 里
const reader = (page: Page) => page.locator('.unit-reader')

test('核查 tab 带未关闭计数，知识席位的复盘与修改记录原样展开', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge?unit=1&view=evidence&tab=review&review=12')

  const tab = reader(page).getByRole('tab', { name: /^核查/ })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(tab).toHaveAccessibleName('核查，1 条未关闭')

  const card = reader(page).getByRole('article', { name: '核查 #12' })
  await expect(card).toHaveAttribute('data-focused', 'true')
  await expect(card.getByText('待你确认')).toBeVisible()
  await expect(card.getByText('知识席位', { exact: true })).toBeVisible()
  // 结论、为什么会错、同类排查三项都在，不折叠
  await expect(card.getByText('已修改')).toBeVisible()
  await expect(card.getByText('v2 的 D 级判断没有 success_def，定级理由只能挤进 asset_text。')).toBeVisible()
  await expect(card.getByText(/查了 c113–c117 的 253 条/)).toBeVisible()
  // 修改记录：字段清单 + 改前改后
  await expect(card.getByRole('list', { name: '改动字段' })).toContainText('payload.asset_text')
  await expect(card.getByText('半导体（按 §0.6 不替他指定阈值）')).toBeVisible()
})

test('提交一条核查，列表与计数随之更新', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge?unit=1&view=evidence&tab=review')

  const panel = reader(page).getByRole('region', { name: '单元核查' })
  await panel.getByRole('button', { name: '＋ 对这条提取提出核查' }).click()
  const form = panel.getByRole('form', { name: '提出核查' })
  const submit = form.getByRole('button', { name: '提交核查' })
  await expect(submit).toBeDisabled()

  await form.getByRole('radio', { name: '分级' }).check()
  await form.getByRole('textbox', { name: '具体说明' }).fill('这条应是 B 级：期限来自我方阶梯，原文只说"中期"。')
  await submit.click()

  const newest = panel.getByRole('article').first()
  await expect(newest.getByText('待知识席位答复')).toBeVisible()
  await expect(newest.getByText('这条应是 B 级：期限来自我方阶梯，原文只说"中期"。')).toBeVisible()
  await expect(reader(page).getByRole('tab', { name: '核查，2 条未关闭' })).toBeVisible()
})

test('待确认入口：答复过的核查在顶栏露头，点进去落在那条核查上', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/asset')

  await page.getByRole('button', { name: '待确认的核查 1 条' }).click()
  const inbox = page.getByRole('region', { name: '待确认的核查' })
  await expect(inbox.getByText('标的与标签')).toBeVisible()
  await inbox.getByRole('link').first().click()

  await expect(page).toHaveURL(/#\/knowledge\?unit=1&view=evidence&tab=review&review=12$/)
  await expect(reader(page).getByRole('tab', { name: /^核查/ })).toHaveAttribute('aria-selected', 'true')
  await expect(reader(page).getByRole('article', { name: '核查 #12' })).toBeInViewport()
})

test('不认可就回复，核查回到知识席位；撤回后关闭，顶栏与计数跟着变', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge?unit=1&view=evidence&tab=review')
  await expect(page.getByRole('button', { name: '待确认的核查 1 条' })).toBeVisible()

  const card = reader(page).getByRole('article', { name: '核查 #12' })
  await card.getByRole('button', { name: '不认可，回复' }).click()
  await card.getByRole('textbox', { name: '回复知识席位' }).fill('另外 12 条同类改完后请列出单元号。')
  await card.getByRole('button', { name: '发送' }).click()

  await expect(card.getByText('待知识席位答复')).toBeVisible()
  await expect(card.getByText('另外 12 条同类改完后请列出单元号。')).toBeVisible()
  // 已经不是 answered 了，顶栏的待确认随之消失
  await expect(page.getByRole('button', { name: /待确认的核查/ })).toHaveCount(0)

  await card.getByRole('button', { name: '撤回核查' }).click()
  await expect(card.getByText('已关闭')).toBeVisible()
  await expect(reader(page).getByRole('tab', { name: /^核查/ })).not.toHaveAccessibleName(/未关闭/)
})

test('关闭已经关闭的核查时显示接口给的原因，状态不变', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge?unit=1&view=evidence&tab=review')

  const card = reader(page).getByRole('article', { name: '核查 #12' })
  // 另一个标签页里已经关掉了：页面还停在"待你确认"，接口回 409
  await page.route('**/knowledge/reviews/12/close', (route) =>
    route.fulfill({ json: { detail: '核查 12 已经关闭' }, status: 409 }))
  await card.getByRole('button', { name: '认可并关闭' }).click()
  await expect(card.getByRole('alert')).toHaveText('核查 12 已经关闭')
  await expect(card.getByText('待你确认')).toBeVisible()
})

test('深链到不在首页那 100 条里的旧单元，打开的就是它，不是列表第一条', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/knowledge?unit=115&view=evidence')

  await expect(reader(page).locator('.unit-lead')).toContainText('UNIT / 115')
  // 窄屏的阅读区是抽屉，深链进来要直接打开
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    await expect(reader(page)).toHaveAttribute('data-open', 'true')
  }
})
