import { Strip, type StripCell } from '../../components/Strip'
import { money, percent, signedMoney } from '../../lib/format'
import { marginRatioRisk } from '../../lib/risk'
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
  const today = pnl?.today.total_usd ?? null
  const futUnreal = pnl?.unrealized.futures_usd ?? null

  const cells: StripCell[] = [
    {
      // 现货盯市 + 当日结算。原先只报结算，不交易的日子屏幕上永远 $0.00，
      // 而持仓明明在涨跌——那是"今天没成交"，不是"今天没赚没亏"。
      label: '今日盈亏',
      id: 'today',
      onOpen: () => onOpenDetail('today'),
      value: today == null ? '—' : signedMoney(today),
      tone: today == null ? 'muted' : today >= 0 ? 'gain' : 'loss',
    },
    {
      // **只有合约。** 现货的未实现要相对买入成本，那个成本要完整的买入历史，
      // 而划转 / 派息 / 小额兑换进来的币在成交记录里没有痕迹，补不齐。
      // 合约这半边是 positionRisk 直接给的，交易所按自己的开仓均价算，拿来即用。
      label: '合约未实现',
      value: futUnreal == null ? '—' : signedMoney(futUnreal),
      tone: futUnreal == null ? 'muted' : futUnreal >= 0 ? 'gain' : 'loss',
    },
    {
      label: '合约保证金率',
      value: ratio === null ? '—' : percent(ratio, 1),
      // 数字自己说安不安全。阈值与风险仪表同源（`lib/risk`）——两处各判一套的话，
      // 摘要条还是黑的，仪表已经写着"偏紧"。安全区不上色：一排读数里
      // 三个都染绿，绿色就不再是"赚了"的意思了。
      tone: ratio === null ? 'muted'
        : marginRatioRisk(ratio).tone === 'gain' ? undefined : marginRatioRisk(ratio).tone,
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
