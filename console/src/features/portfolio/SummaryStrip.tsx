import { Strip, type StripCell } from '../../components/Strip'
import { money, percent, signedMoney, signedPercent } from '../../lib/format'
import { exposures, spotHoldings } from '../../lib/holdings'
import { marginRatioRisk } from '../../lib/risk'
import { breakingDrop, positionSize } from '../../lib/stress'
import type { FundSnapshot, PortfolioSnapshot } from '../../api/types'
import type { PnlTopic } from './PnlDetail'
import type { ViewKey } from './StatementPage'

/**
 * 常驻摘要条。版式与另外两页共用 `<Strip>`——三页应当像同一份文件的三章。
 *
 * **每格只有标签和数值组，没有解释小注。** 原先每格底下挂一行小注：保证金率下面写
 * "安全"，未实现盈亏取不到时写"不可用"。三格里只有一格常年有字，那两个字既
 * 撑高了整条又把这一格弄得和邻居不齐；而"安全"说的是 12% 已经说过的事。
 * 需要提醒的时候改用颜色——同一个数字自己变色，不多占一行。
 */
export function SummaryStrip({ snapshot, fund, onOpenDetail, view }: {
  snapshot: PortfolioSnapshot
  fund: FundSnapshot | null
  onOpenDetail: (topic: PnlTopic) => void
  view: Exclude<ViewKey, 'accounts'>
}) {
  const { hero, cells } = summaryForView(snapshot, view, onOpenDetail, fund)
  return <Strip cells={cells} dense={view === 'perp'} hero={hero} />
}

/** 各页只报本页数据；资金流水使用自己的 LedgerStrip。 */
export function summaryForView(snapshot: PortfolioSnapshot, view: Exclude<ViewKey, 'accounts'>,
                               onOpenDetail: (topic: PnlTopic) => void,
                               fund: FundSnapshot | null = null): {
  hero: StripCell; cells: StripCell[]
} {
  const totals = snapshot.totals
  const pnl = snapshot.pnl
  const ratio = snapshot.futures?.margin_ratio ?? null
  const today = pnl?.today.total_usd ?? null
  const futUnreal = pnl?.unrealized.futures_usd ?? null
  // 管理员录入的两项（见「用户」页）：交易所以外的现金、账户初始净值
  const cash = fund?.settings.cash_usd ?? null
  const initialNav = fund?.settings.initial_nav_usd ?? null
  // 净值已经含现金（取数时并进来的，见 lib/fund.ts 的 withCash），这里和各处「占净值」、
  // 风险读数用的是同一个数
  const nav = totals?.equity_usd ?? null
  const sinceStart = nav !== null && initialNav ? nav - initialNav : null

  const marginTone = ratio === null ? 'muted' as const
    : marginRatioRisk(ratio).tone === 'gain' ? undefined : marginRatioRisk(ratio).tone
  const marginCell: StripCell = {
    label: '合约保证金率', value: ratio === null ? '—' : percent(ratio, 1), tone: marginTone,
  }

  if (view === 'holdings') {
    // 股票钱包行也在 spotHoldings 中；股票单列后要按 asset_code 去重。
    const stockAssets = new Set([...snapshot.stocks.equity_holdings, ...snapshot.stocks.tokenized_assets]
      .map((row) => row.asset_code))
    const cryptoRows = spotHoldings(snapshot).filter((row) => !stockAssets.has(row.asset))
    const stockRows = [...snapshot.stocks.equity_holdings, ...snapshot.stocks.tokenized_assets]
    const allRows = [...cryptoRows, ...stockRows]
    const unavailableSource = snapshot.sources.some((source) =>
      ['spot', 'futures', 'margin', 'stocks', 'prices'].includes(source.key)
      && source.status !== 'ok' && source.status !== 'unsupported')
    const cryptoValue = cryptoRows.length > 0 && cryptoRows.every((row) => row.value_usd === null)
      ? null : cryptoRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
    const stockValue = stockRows.length > 0 && stockRows.every((row) => row.value_usd === null)
      ? null : stockRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
    const knownRows = allRows.filter((row) => row.value_usd !== null)
    const value = knownRows.length > 0
      ? knownRows.reduce((sum, row) => sum + row.value_usd!, 0)
      : allRows.length === 0 && !unavailableSource ? 0 : null
    const incomplete = unavailableSource || knownRows.length !== allRows.length
    return {
      hero: { label: incomplete ? '已估值持仓' : '持仓价值', value: value === null ? '—' : money(value) },
      cells: [
        { label: '现货', value: cryptoValue === null ? '—' : money(cryptoValue) },
        { label: '股票', value: stockValue === null ? '—' : money(stockValue) },
        { label: '占账户净值', value: value === null || !totals || totals.equity_usd <= 0
          ? '—' : percent(value / totals.equity_usd, 1) },
      ],
    }
  }

  if (view === 'perp') {
    const f = snapshot.futures
    const size = positionSize(snapshot)
    const unreal = f?.total_unrealized_pnl ?? null
    const leverage = f && size !== null && f.total_margin_balance > 0
      ? size / f.total_margin_balance : null
    const estimated = f?.estimated_funding_fee_usd ?? null
    const estimatedRate = f?.estimated_funding_rate ?? null
    const todayFunding = f ? pnl?.today?.settled_parts?.funding_fee ?? null : null
    const todayRate = todayFunding !== null && size !== null && size > 0
      ? todayFunding / size : null
    return {
      hero: { label: '仓位价值', value: size === null ? '—' : money(size) },
      cells: [
        { label: '未实现盈亏', value: unreal === null ? '—' : signedMoney(unreal),
          tone: unreal === null ? 'muted' : unreal >= 0 ? 'gain' : 'loss' },
        { label: '保证金余额', value: f ? money(f.total_margin_balance) : '—' },
        { label: '真实杠杆', value: leverage === null ? '—' : `${leverage.toFixed(2)}×`,
          compact: true, mobileHeroAside: true },
        { label: '预估资金费用', value: estimated === null ? '—' : signedMoney(estimated),
          detail: estimatedRate === null ? undefined : signedPercent(-estimatedRate, 4),
          compact: true,
          tone: estimated === null ? 'muted' : estimated > 0 ? 'gain' : estimated < 0 ? 'loss' : undefined },
        { label: '今日资金费用', value: todayFunding === null ? '—' : signedMoney(todayFunding),
          detail: todayRate === null ? undefined : signedPercent(todayRate, 4),
          compact: true,
          tone: todayFunding === null ? 'muted' : todayFunding > 0 ? 'gain' : todayFunding < 0 ? 'loss' : undefined },
      ],
    }
  }

  if (view === 'risk') {
    const edge = breakingDrop(snapshot)
    const largest = totals && totals.equity_usd > 0
      ? exposures(snapshot, totals.equity_usd)[0]?.share ?? null : null
    const leverage = totals?.gross_exposure_ratio ?? null
    return {
      hero: marginCell,
      cells: [
        { label: '临界跌幅', value: edge === null ? '—' : percent(edge, 1) },
        { label: '最大净持仓 / 净值', value: largest === null ? '—' : percent(largest, 1) },
        { label: '合约价值 / 净值', value: leverage === null ? '—' : `${leverage.toFixed(2)}×` },
      ],
    }
  }

  const cells: StripCell[] = [
    {
      // = 日历最后一格（现货当天涨跌 + 当天结算），不另算一遍。
      // 原先只报结算，不成交的日子屏幕上永远 $0.00，而持仓明明在涨跌。
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
    // 原先这一格是合约保证金率，2026-10-03 换成账户相对初始净值的盈亏（初始净值在
    // 「用户」页录入）。保证金率还在「风险」那一节的主数字上。
    {
      label: '盈亏',
      value: sinceStart === null ? '—' : signedMoney(sinceStart),
      detail: sinceStart === null ? undefined : signedPercent(sinceStart / initialNav!, 2),
      tone: sinceStart === null ? 'muted' : sinceStart >= 0 ? 'gain' : 'loss',
    },
    { label: '现金', value: cash === null ? '—' : money(cash) },
  ]

  return { hero: { label: '净值', value: nav === null ? '—' : money(nav) }, cells }
}
