import { Strip, type StripCell } from '../../components/Strip'
import { money, percent, signedMoney } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import type { PnlTopic } from './PnlDetail'

/**
 * 常驻摘要条。版式与另外两页共用 `<Strip>`——三页应当像同一份文件的三章。
 *
 * **每格只有标签和数字，没有第三行。** 原先每格底下挂一行小注：保证金率下面写
 * "安全"，未实现盈亏取不到时写"不可用"。三格里只有一格常年有字，那两个字既
 * 撑高了整条又把这一格弄得和邻居不齐；而"安全"说的是 12% 已经说过的事。
 * 需要提醒的时候改用颜色——同一个数字自己变色，不多占一行。
 */
export function SummaryStrip({ snapshot, veiled, onOpenDetail }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  onOpenDetail: (topic: PnlTopic) => void
}) {
  const totals = snapshot.totals
  const pnl = snapshot.pnl
  const ratio = snapshot.futures?.margin_ratio ?? null

  // 现货与合约各有各的取不到的可能：一边缺就只报另一边，别把 null 当 0 加进去
  const sum = (...parts: (number | null | undefined)[]) => {
    const known = parts.filter((p): p is number => p != null)
    return known.length ? known.reduce((a, b) => a + b, 0) : null
  }
  const unreal = sum(pnl?.unrealized.spot_usd, pnl?.unrealized.futures_usd)

  const cells: StripCell[] = [
    {
      // 原先是"今日净值变化"，拿全部钱包减昨天的日快照——理财余额每天都被算成
      // "今天赚的"。改成今日实际落袋，只认成交与结算。
      label: '今日盈亏',
      id: 'today',
      onOpen: () => onOpenDetail('today'),
      value: pnl?.today_usd == null ? '—' : signedMoney(pnl.today_usd),
      tone: pnl?.today_usd == null ? 'muted' : pnl.today_usd >= 0 ? 'gain' : 'loss',
    },
    {
      // 未实现盈亏来自成交重放（现货）与 positionRisk（合约），不是"期末 − 期初"。
      // 后者在 Binance 上算不准：日快照只有三个钱包，钱包间划转会被算成盈亏。
      label: '未实现盈亏',
      id: 'unrealized',
      onOpen: () => onOpenDetail('unrealized'),
      value: unreal == null ? '—' : signedMoney(unreal),
      tone: unreal == null ? 'muted' : unreal >= 0 ? 'gain' : 'loss',
    },
    {
      label: '合约保证金率',
      value: ratio === null ? '—' : percent(ratio, 1),
      // 数字自己说安不安全：过半转金，接近八成转红。取不到就是 `—`，
      // 哪个来源挂了报头那一行已经在说了。
      tone: ratio === null ? 'muted' : ratio >= 0.8 ? 'loss' : ratio >= 0.5 ? 'warn' : undefined,
    },
  ]

  return (
    <Strip
      cells={cells}
      hero={{ label: '净值', value: totals ? money(totals.equity_usd) : '—' }}
      veiled={veiled}
    />
  )
}
