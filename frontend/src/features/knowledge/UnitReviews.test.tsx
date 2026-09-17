import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UnitReviews from './UnitReviews'
import type { UnitReview } from './reviews'

const member = {
  status: 'authenticated',
  user: { id: 1, username: 'mur', role: 'member', display_name: 'mur', is_active: true, last_login_at: null },
}

const session = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../shared/auth/session', () => ({
  getSession: () => session.current,
  subscribe: () => () => {},
}))

const answered: UnitReview = {
  id: 12, unit_id: 1518, category: 'asset', status: 'answered', created_by: 'mur',
  created_at: '2026-09-13T12:00:00Z', updated_at: '2026-09-13T13:00:00Z', closed_at: null,
  messages: [
    { id: 30, role: 'reviewer', author: 'mur', body: '「标的」一栏显示的是定级理由', created_at: '2026-09-13T12:00:00Z', resolution: null },
    {
      id: 31, role: 'extractor', author: 'claude-session', body: '确认有误', created_at: '2026-09-13T13:00:00Z',
      resolution: {
        outcome: 'fixed',
        root_cause: 'D 级没有 success_def，理由挤进了 asset_text',
        sweep: 'c113–c117 另有 12 条同类，已改',
        followup: '理由的去处在规范 §7 另议',
      },
    },
  ],
  amendments: [{
    id: 4, unit_id: 1518, reason: 'asset_text 恢复为原文表述', author: 'claude-session',
    created_at: '2026-09-13T12:59:00Z', changed: ['payload.asset_text', 'tags'],
    before: { quote: 'q', payload: { asset_text: '美股（作者判即使数据不及预期、跌幅也有限）' }, tags: ['spx'] },
    after: { quote: 'q', payload: { asset_text: '美股' }, tags: ['spx', 'cpi'] },
  }],
}

function renderPanel(reviews: UnitReview[] = [answered]) {
  const onChanged = vi.fn()
  render(<UnitReviews onChanged={onChanged} onRetry={vi.fn()} reviews={reviews} state="loaded" unitId={1518} />)
  return onChanged
}

function jsonReply(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => { session.current = member })
afterEach(() => { vi.unstubAllGlobals() })

describe('单元核查面板', () => {
  it('知识席位的复盘原样展开：结论、为什么会错、同类排查、后续一项不少', () => {
    renderPanel()
    const card = screen.getByRole('article', { name: '核查 #12' })
    expect(within(card).getByText('已修改')).toBeTruthy()
    expect(within(card).getByText('D 级没有 success_def，理由挤进了 asset_text')).toBeTruthy()
    expect(within(card).getByText('c113–c117 另有 12 条同类，已改')).toBeTruthy()
    expect(within(card).getByText('理由的去处在规范 §7 另议')).toBeTruthy()
    // 对话串区分"你"与"知识席位"
    expect(within(card).getByText('你')).toBeTruthy()
    expect(within(card).getByText('知识席位')).toBeTruthy()
  })

  it('修改记录列出改动字段，逐个给改前与改后', () => {
    renderPanel()
    const changed = screen.getByRole('list', { name: '改动字段' })
    expect(within(changed).getByText('payload.asset_text')).toBeTruthy()
    expect(within(changed).getByText('tags')).toBeTruthy()
    expect(screen.getByText('美股（作者判即使数据不及预期、跌幅也有限）')).toBeTruthy()
    expect(screen.getByText('美股')).toBeTruthy()
    expect(screen.getByText('spx · cpi')).toBeTruthy()
  })

  it('提交要先选类别、写说明；成功后把接口返回的核查交给上层', async () => {
    const created: UnitReview = { ...answered, id: 13, status: 'open', category: 'grade', messages: [answered.messages[0]], amendments: [] }
    const fetchMock = vi.fn().mockResolvedValue(jsonReply(201, created))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = renderPanel([])

    const submit = screen.getByRole('button', { name: '提交核查' })
    expect(submit).toHaveProperty('disabled', true)
    await userEvent.type(screen.getByRole('textbox', { name: '具体说明' }), '应为 B 级')
    expect(submit).toHaveProperty('disabled', true)            // 还没选类别
    await userEvent.click(screen.getByRole('radio', { name: '分级' }))
    await userEvent.click(submit)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/knowledge/units/1518/reviews'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ category: 'grade', body: '应为 B 级' }) }),
    )
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(created))
  })

  it('409 显示接口给的原因', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonReply(409, { detail: '核查 12 已经关闭' })))
    renderPanel()
    const card = screen.getByRole('article', { name: '核查 #12' })

    await userEvent.click(within(card).getByRole('button', { name: '认可并关闭' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('核查 12 已经关闭')
  })

  it('不分角色：管理员与成员看到的入口一样', () => {
    const buttons = () => screen.getAllByRole('button').map((button) => button.textContent)
    const { unmount } = render(<UnitReviews onChanged={vi.fn()} onRetry={vi.fn()} reviews={[answered]} state="loaded" unitId={1518} />)
    const asMember = buttons()
    unmount()
    session.current = { status: 'authenticated', user: { ...member.user, role: 'admin' } }
    renderPanel()
    expect(buttons()).toEqual(asMember)
    expect(asMember).toContain('认可并关闭')
  })
})
