import { describe, expect, it } from 'vitest'
import {
  dayLabel, defaultStart, formatRealized, indexOfDay, kindCounts, kindOf, matchesQuery, matchesRoute, parseDay, parseRoute, routeFor,
  summarizeDays, todayKey,
  type QueueItem,
} from './records'
import type { VerificationOutcome } from './types'

const base = {
  quote: '半导体这一段还没走完', payload: { asset_symbol: 'SOXX' }, published_at: '2026-08-01T00:00:00Z',
  ref_price_at_publish: 250, creator: '测试信源', content_title: '样本',
}

const scored = (scoreId: number, unitId: number, horizon: string, outcome: VerificationOutcome, creator = base.creator): QueueItem => ({
  ...base, creator, unit_id: unitId, horizon_label: horizon, score_id: scoreId, outcome, realized: null,
  eval_ts: `${horizon}T12:00:00Z`, scored_at: `${horizon}T12:00:00Z`,
})

const due = (unitId: number, horizon: string): QueueItem => ({ ...base, unit_id: unitId, horizon_label: horizon })

describe('verification records', () => {
  it('round-trips score and due routes, and reads the chosen day', () => {
    const score = scored(42, 1, '2026-08-10', 'hit')
    const upcoming = due(7, '2026-10-01')
    expect(parseRoute(routeFor(score))).toEqual({ kind: 'score', scoreId: 42 })
    expect(parseRoute(routeFor(upcoming))).toEqual({ kind: 'due', unitId: 7, horizon: '2026-10-01' })
    expect(parseRoute('#/verification')).toBeNull()
    expect(parseRoute('#/verification?score=abc')).toBeNull()
    expect(matchesRoute(score, { kind: 'score', scoreId: 42 })).toBe(true)
    // 分数与到期不会互相匹配，即使单元相同
    expect(matchesRoute(upcoming, { kind: 'score', scoreId: 7 })).toBe(false)
    expect(matchesRoute(upcoming, { kind: 'due', unitId: 7, horizon: '2026-09-01' })).toBe(false)
    expect(parseDay('#/verification?day=2026-09-13')).toBe('2026-09-13')
    expect(parseDay('#/verification?day=0913')).toBeNull()
  })

  it('sorts every outcome into one of six kinds', () => {
    expect(kindOf(scored(1, 1, '2026-08-10', 'hit'))).toBe('hit')
    expect(kindOf(scored(1, 1, '2026-08-10', 'partial'))).toBe('partial')
    expect(kindOf(scored(1, 1, '2026-08-10', 'miss'))).toBe('miss')
    expect(kindOf(scored(1, 1, '2026-08-10', 'condition_not_met'))).toBe('review')
    expect(kindOf(scored(1, 1, '2026-08-10', 'pending'))).toBe('review')
    expect(kindOf(scored(1, 1, '2026-08-10', 'unpriceable'))).toBe('void')
    expect(kindOf(scored(1, 1, '2026-08-10', 'condition_unverifiable'))).toBe('void')
    expect(kindOf(due(1, '2026-10-01'))).toBe('due')
  })

  it('summarizes by day in date order, verdicts before open items within a day', () => {
    const days = summarizeDays([
      due(9, '2026-10-01'),
      scored(3, 3, '2026-08-10', 'miss', '乙'),
      scored(1, 1, '2026-08-10', 'condition_not_met'),
      scored(2, 2, '2026-08-10', 'hit', '甲'),
      scored(4, 4, '2026-08-09', 'hit'),
    ])
    expect(days.map((entry) => entry.day)).toEqual(['2026-08-09', '2026-08-10', '2026-10-01'])
    expect(days[1].items.map((item) => item.unit_id)).toEqual([2, 3, 1])
    expect([days[1].hit, days[1].miss, days[1].review, days[1].due]).toEqual([1, 1, 1, 0])
    expect(days[2].due).toBe(1)
  })

  it('opens the card window on the latest screenful of results up to today', () => {
    const sequence = summarizeDays([
      scored(1, 1, '2026-08-10', 'hit'), scored(2, 2, '2026-08-20', 'miss'), scored(3, 3, '2026-09-05', 'miss'),
      due(4, '2026-09-18'), due(5, '2026-09-20'),
    ]).flatMap((entry) => entry.items)
    // 最近一条结果是第 3 条（下标 2）；窗口放 2 张就从下标 1 开始，今天那堆到期项不算结果
    expect(defaultStart(sequence, '2026-09-18', 2)).toBe(1)
    expect(defaultStart(sequence, '2026-09-18', 10)).toBe(0)
    expect(defaultStart(sequence.slice(3), '2026-09-18', 2)).toBe(0)
    expect(indexOfDay(sequence, '2026-08-20')).toBe(1)
    expect(indexOfDay(sequence, '2026-09-01')).toBe(2)
    expect(indexOfDay(sequence, '2027-01-01')).toBe(4)
  })

  it('searches quote, creator, title and symbol, and counts kinds', () => {
    const item = scored(1, 1, '2026-08-10', 'hit')
    expect(matchesQuery(item, 'soxx')).toBe(true)
    expect(matchesQuery(item, '测试信源')).toBe(true)
    expect(matchesQuery(item, '黄金')).toBe(false)
    expect(kindCounts([item, scored(2, 1, '2026-08-20', 'miss'), due(1, '2026-10-01')]))
      .toEqual({ hit: 1, partial: 0, miss: 1, review: 0, void: 0, due: 1 })
  })

  it('formats days and realized values', () => {
    expect(dayLabel('2026-09-14')).toBe('09/14 周一')
    expect(todayKey(new Date('2026-09-17T18:00:00Z'))).toBe('2026-09-18')
    expect(formatRealized('asset_ret', .0481)).toBe('+4.81%')
    expect(formatRealized('max_dd', .0294)).toBe('2.94%')
    expect(formatRealized('eval_close', 6909.9102)).toBe('6,909.91')
    expect(formatRealized('eval_close', .3215)).toBe('0.3215')
    expect(formatRealized('cond_date', '2026-07-13')).toBe('2026-07-13')
    expect(formatRealized('ref', null)).toBeNull()
  })
})
