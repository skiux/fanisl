import { describe, expect, it } from 'vitest'
import { isReviewQueue, isUnitReview } from '../../shared/api/contracts'
import { fieldLabel, reviewHref, snapshotValue, unclosedCount, type UnitReview } from './reviews'

describe('单元核查的取值', () => {
  it('计数只算没关闭的：open 在等知识席位，answered 在等你', () => {
    const review = (status: UnitReview['status']) => ({ status, messages: [], amendments: [] }) as unknown as UnitReview
    expect(unclosedCount([review('open'), review('answered'), review('closed')])).toBe(2)
    expect(unclosedCount([])).toBe(0)
  })

  it('修改记录按字段路径取改前改后，字段名补中文但不吞掉原键名', () => {
    const snapshot = { quote: '原句', payload: { asset_text: '美股' }, tags: ['spx'] }
    expect(snapshotValue(snapshot, 'quote')).toBe('原句')
    expect(snapshotValue(snapshot, 'tags')).toEqual(['spx'])
    expect(snapshotValue(snapshot, 'payload.asset_text')).toBe('美股')
    expect(snapshotValue(snapshot, 'payload.missing')).toBeUndefined()
    expect(fieldLabel('payload.asset_text')).toBe('标的说明')
    expect(fieldLabel('payload.brand_new_key')).toBe('brand_new_key')
  })

  it('直达链接落在核查 tab，并带上要滚到的那一条', () => {
    expect(reviewHref(1518, 12)).toBe('#/knowledge?unit=1518&view=evidence&tab=review&review=12')
    expect(reviewHref(1518)).toBe('#/knowledge?unit=1518&view=evidence&tab=review')
  })

  it('契约：对话串或修改记录形状不对就挡下，不让它在渲染期炸', () => {
    const review = {
      id: 1, unit_id: 2, category: 'quote', status: 'open',
      messages: [{ role: 'reviewer', body: 'x', resolution: null }],
      amendments: [{ changed: ['quote'], before: {}, after: {} }],
    }
    expect(isUnitReview(review)).toBe(true)
    expect(isUnitReview({ ...review, messages: undefined })).toBe(false)
    expect(isUnitReview({ ...review, amendments: [{ changed: 'quote', before: {}, after: {} }] })).toBe(false)
    expect(isReviewQueue([{ id: 1, unit_id: 2, status: 'answered', quote: 'q' }])).toBe(true)
    expect(isReviewQueue({ items: [] })).toBe(false)
  })
})
