import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Lightning } from '@phosphor-icons/react'
import { compareBy, SortBy, type SortKey, type SortState } from '../../components/controls'
import { Delta } from '../../components/Primitives'
import { Ticker } from '../../components/Ticker'
import { cn } from '../../lib/cn'
import { amount, baseOf, money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import { liqDistanceRisk, riskBar } from '../../lib/risk'
import type { FuturesAccount, FuturesPosition } from '../../api/types'
import { useViewportListHeight } from './useViewportListHeight'

function AdlPips({ quantile }: { quantile: number | null }) {
  if (quantile === null) return null
  return (
    <span
      aria-label={`自动减仓排队分位 ${quantile} / 4`}
      className="flex items-center gap-1"
      role="img"
      title={`自动减仓排队分位 ${quantile}/4`}
    >
      <Lightning aria-hidden="true" className={quantile >= 3 ? 'text-loss' : 'text-ink-3'} size={10} weight="fill" />
      <span className="flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((step) => (
          <i
            className={cn(
              'h-[7px] w-[3px] rounded-[1px]',
              step < quantile ? (quantile >= 3 ? 'bg-loss' : 'bg-ink-3') : 'bg-rule-strong',
            )}
            key={step}
          />
        ))}
      </span>
    </span>
  )
}

const SESSION_LABEL: Record<string, string> = {
  PRE_MARKET: '盘前',
  POST_MARKET: '盘后',
  OVERNIGHT: '隔夜',
  CLOSED: '休市',
  NO_TRADING: '休市',
}

const SYMBOL_ADL_LABEL: Record<string, string> = {
  low: 'ADL 低',
  medium: 'ADL 中',
  high: 'ADL 高',
}

function PositionRow({ position }: { position: FuturesPosition }) {
  const long = position.position_amt >= 0
  const pnlPct = position.initial_margin_usd > 0
    ? position.unrealized_pnl_usd / position.initial_margin_usd
    : null
  const distance = position.liq_distance
  const risk = liqDistanceRisk(distance)

  return (
    // **图标在整行的左边，其余全部缩进对齐到标的名。** 上一版只把标题那一行推开，
    // 底下的开仓/标记/强平与距强平条还从图标下面起头——同一行里两套左边界，
    // 看着像图标压在了表格上。
    <li className="flex gap-3 py-4 first:pt-0">
      <Ticker asset={baseOf(position.symbol)} />
      <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-ink">{baseOf(position.symbol)}</span>
            {/* 方向用中性色 + 箭头：绿/红在这个界面里只表示盈亏 */}
            <span className="flex items-center gap-1 rounded-[4px] bg-sheet-2 px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-wider text-ink-2">
              {long ? <ArrowUp aria-hidden="true" size={9} weight="bold" /> : <ArrowDown aria-hidden="true" size={9} weight="bold" />}
              {long ? 'Long' : 'Short'}
            </span>
            <AdlPips quantile={position.adl_quantile} />
            {position.tradfi && position.market_session && SESSION_LABEL[position.market_session] && (
              <span className="rounded-[4px] border border-rule px-1.5 py-px text-[9.5px] text-ink-3">
                {SESSION_LABEL[position.market_session]}
              </span>
            )}
          </div>
          <div className="tnum mt-1 text-xs text-ink-3">
            {/* 持仓数量：方向已经由上面的 Long/Short 表达，这里给绝对值 */}
            {/* 标的代码上面那行已经有了，这里只给数量 */}
            <span className="text-ink-2">{amount(Math.abs(position.position_amt))}</span>
            {' · '}{position.leverage}× · {position.isolated ? '逐仓' : '全仓'} · {money(position.notional_usd)}
            {position.symbol_adl_risk && (
              <> · <span className={position.symbol_adl_risk === 'high' ? 'text-loss' : ''}>
                {SYMBOL_ADL_LABEL[position.symbol_adl_risk] ?? `ADL ${position.symbol_adl_risk}`}
              </span></>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Delta className="text-sm" value={position.unrealized_pnl_usd}>
            {signedMoney(position.unrealized_pnl_usd)}
          </Delta>
          <div className="tnum text-xs text-ink-3">{signedPercent(pnlPct)}</div>
        </div>
      </div>

      <dl className="tnum mt-3 grid grid-cols-3 gap-x-3 text-xs">
        {([
          ['开仓', price(position.entry_price)],
          ['标记', price(position.mark_price)],
          ['强平', price(position.liquidation_price)],
        ] as const).map(([label, value]) => (
          <div className="min-w-0 whitespace-nowrap" key={label}>
            <dt className="text-ink-3">{label}</dt>
            <dd className="truncate text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>

      {distance !== null && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-rule">
            <span
              className={cn('block h-full rounded-full transition-[width] duration-700',
                riskBar(risk.tone))}
              style={{ width: `${(risk.fill * 100).toFixed(1)}%` }}
            />
          </span>
          <span className="tnum shrink-0 text-xs text-ink-3">距强平 {percent(distance, 1)}</span>
        </div>
      )}
      </div>
    </li>
  )
}

/**
 * 仓位的排序键。**每个键自带"要紧的在哪一头"**，见 `SortKey.initial`——
 * 金额与盈亏是从大到小，而「距强平」是从近到远：那一列本来就是用来找最危险的
 * 那个仓位的，给它 `desc` 等于把最安全的顶到最上面。
 */
type PositionSort = 'notional' | 'pnl' | 'liq'

const POSITION_KEYS: SortKey<PositionSort>[] = [
  { value: 'notional', label: '价值', initial: 'desc' },
  { value: 'pnl', label: '未实现', initial: 'desc' },
  { value: 'liq', label: '距强平', initial: 'asc' },
]

const POSITION_VALUE: Record<PositionSort, (p: FuturesPosition) => number | null> = {
  notional: (p) => p.notional_usd,
  pnl: (p) => p.unrealized_pnl_usd,
  liq: (p) => p.liq_distance,
}

/**
 * 守卫写在**挂载之前**，不是组件内部提前 return——里面有 `useState`/`useMemo`，
 * 提前 return 会让 hook 顺序随数据变。这条在 `RealizedDays` 上造成过一次整页白屏。
 */
export function PositionsList({ futures, unavailable }: {
  futures: FuturesAccount | null
  unavailable: boolean
}) {
  if (unavailable) {
    return <p className="py-10 text-center text-sm text-ink-3">本次未取到合约数据。</p>
  }
  if (!futures || futures.positions.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">当前没有合约持仓。</p>
  }
  return <SortedPositions positions={futures.positions} />
}

function SortedPositions({ positions }: { positions: FuturesPosition[] }) {
  // 默认按名义从大到小。接口给的顺序是账户内部的次序，和"哪个仓位要紧"无关——
  // 让最大的那笔排在第一行，比原样照抄有意义。
  const [sort, setSort] = useState<SortState<PositionSort>>({ key: 'notional', direction: 'desc' })
  const { ref, height } = useViewportListHeight()

  const rows = useMemo(() => {
    const out = [...positions]
    const pick = POSITION_VALUE[sort.key]
    out.sort((a, b) => compareBy(pick(a), pick(b), sort.direction))
    return out
  }, [positions, sort])

  return (
    <>
      {/* 一个仓位的时候排序条是纯噪声：没有第二行可以换位置 */}
      {positions.length > 1 && (
        <div className="mb-1 border-b border-rule pb-2.5">
          <SortBy keys={POSITION_KEYS} label="仓位顺序" onChange={setSort} showLabel={false} value={sort} />
        </div>
      )}
      <ul aria-label="合约仓位列表" className="scroll-y" data-scroll-region="perp-positions"
        ref={ref} style={{ maxHeight: height ?? undefined }} tabIndex={height !== null ? 0 : undefined}>
        {rows.map((position) => (
          <PositionRow key={`${position.symbol}-${position.position_side}`} position={position} />
        ))}
      </ul>
    </>
  )
}
