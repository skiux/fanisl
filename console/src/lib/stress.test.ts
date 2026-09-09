import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../api/fixtures'
import { breakingDrop, shock } from './stress'

const snap = buildSnapshot(new Date('2026-09-08T12:00:00Z'))

describe('shock', () => {
  it('未实现从开仓价重算，不是拿总额去加减', () => {
    // 不跌的时候必须等于接口给的那个数，否则后面每一档都带着同一个偏差
    expect(shock(snap, 0).unrealized_usd)
      .toBeCloseTo(snap.futures!.total_unrealized_pnl, 2)
    expect(shock(snap, 0).margin_balance)
      .toBeCloseTo(snap.futures!.total_margin_balance, 2)
  })

  it('维持保证金随名义等比缩小', () => {
    const f = snap.futures!
    const hit = shock(snap, 0.3)
    // 保证金率 = 维持保证金 × 0.7 / 冲击后的保证金余额
    expect(hit.margin_ratio!)
      .toBeCloseTo(f.total_maint_margin * 0.7 / hit.margin_balance!, 6)
  })

  it('跌得越狠净值越低、保证金率越高', () => {
    const mild = shock(snap, 0.1)
    const harsh = shock(snap, 0.4)
    expect(harsh.equity_usd!).toBeLessThan(mild.equity_usd!)
    expect(harsh.margin_ratio!).toBeGreaterThan(mild.margin_ratio!)
  })

  it('只报逐仓的强平，全仓交给保证金率', () => {
    // 全仓的 liquidationPrice 是"别的都不动"算出来的，普跌时那个价不成立。
    // 两套判据混着报会自相矛盾：屏幕上出现过"保证金率 8.6% 安全"底下挂着
    // 两行"触及强平价"。
    const cross = new Set(snap.futures!.positions
      .filter((p) => !p.isolated).map((p) => p.symbol))
    expect(shock(snap, 0.5).liquidated.filter((s) => cross.has(s))).toEqual([])
  })
})

describe('breakingDrop', () => {
  it('解出来的那个跌幅上保证金率正好到 1', () => {
    const edge = breakingDrop(snap)!
    expect(edge).toBeGreaterThan(0)
    expect(shock(snap, edge).margin_ratio!).toBeCloseTo(1, 2)
    // 差一点点还没到，跨过去就过了——这才说明找到的是边界不是随便一个数
    expect(shock(snap, edge - 0.01).margin_ratio!).toBeLessThan(1)
  })

  it('补保证金能扛更多', () => {
    expect(breakingDrop(snap, 20_000)).toBeNull()   // 补够了就不会强平
    const more = breakingDrop(snap, 2_000)!
    expect(more).toBeGreaterThan(breakingDrop(snap)!)
  })

  it('没有仓位时问题不成立，返回 null 而不是 0', () => {
    expect(breakingDrop({ ...snap, futures: { ...snap.futures!, positions: [] } })).toBeNull()
  })

  it('净空头不会因为普跌强平', () => {
    // 数值搜索就是为了这种情形：解析解在这里分母变号，一个漏掉的绝对值
    // 会把"永远不会强平"算成"跌 3% 就爆"
    const shorts = {
      ...snap,
      futures: {
        ...snap.futures!,
        positions: snap.futures!.positions.map((p) => ({
          ...p, position_amt: -Math.abs(p.position_amt),
        })),
      },
    }
    expect(breakingDrop(shorts)).toBeNull()
  })
})
