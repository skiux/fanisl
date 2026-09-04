import { ArrowDown, ArrowUp, Lightning } from '@phosphor-icons/react'
import { Delta, Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { amount, baseOf, money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import {
  MARGIN_LEVEL_SAFE, MARGIN_LEVEL_WARN, MARGIN_RATIO_DANGER,
  liqDistanceRisk, marginLevelRisk, marginRatioRisk, riskBar, riskText,
} from '../../lib/risk'
import type { FuturesAccount, FuturesPosition, MarginAccount } from '../../api/types'

function Gauge({ label, value, hint, tone, fill, marker }: {
  label: string
  value: string
  hint: string
  tone: string
  fill: number
  marker?: number
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        <span className={cn('tnum text-sm', tone)}>{value} <span className="text-ink-3">· {hint}</span></span>
      </div>
      <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-rule">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]', tone.replace('text-', 'bg-'))}
          style={{ width: `${Math.min(100, Math.max(0, fill * 100)).toFixed(1)}%` }}
        />
        {marker !== undefined && (
          <span className="absolute inset-y-0 w-px bg-ink-3/60" style={{ left: `${marker * 100}%` }} />
        )}
      </div>
    </div>
  )
}

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

function PositionRow({ position }: { position: FuturesPosition }) {
  const long = position.position_amt >= 0
  const pnlPct = position.initial_margin_usd > 0
    ? position.unrealized_pnl_usd / position.initial_margin_usd
    : null
  const distance = position.liq_distance
  const risk = liqDistanceRisk(distance)

  return (
    <li className="py-4 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-ink">{baseOf(position.symbol)}</span>
            {/* 方向用中性色 + 箭头：绿/红在这个界面里只表示盈亏 */}
            <span className="flex items-center gap-1 rounded-[4px] bg-sheet-2 px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-wider text-ink-2">
              {long ? <ArrowUp aria-hidden="true" size={9} weight="bold" /> : <ArrowDown aria-hidden="true" size={9} weight="bold" />}
              {long ? 'Long' : 'Short'}
            </span>
            <AdlPips quantile={position.adl_quantile} />
          </div>
          <div className="tnum mt-1 text-xs text-ink-3">
            {/* 持仓数量：方向已经由上面的 Long/Short 表达，这里给绝对值 */}
            {/* 标的代码上面那行已经有了，这里只给数量 */}
            <span className="text-ink-2">{amount(Math.abs(position.position_amt))}</span>
            {' · '}{position.leverage}× · {position.isolated ? '逐仓' : '全仓'} · {money(position.notional_usd)}
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
    </li>
  )
}

export function RiskGauges({ futures, margin, exposureRatio, concentration, unavailable }: {
  futures: FuturesAccount | null
  margin: MarginAccount | null
  exposureRatio: number | null
  concentration: { asset: string; share: number } | null
  unavailable: boolean
}) {
  if (unavailable) {
    return (
      <div className="mt-3.5 flex flex-col">
        <p className="text-sm text-ink-2">合约数据本次没有取到</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          保证金率与强平距离都算不出来，这一节不猜。
        </p>
      </div>
    )
  }
  return (
    <div className="mt-3.5 flex flex-col gap-4">
      {futures?.margin_ratio != null && (
        <Gauge
          fill={futures.margin_ratio}
          hint={marginRatioRisk(futures.margin_ratio).label}
          label="合约保证金率"
          // 标记线就是判红那条线，两者同源；小数位也与摘要条同一档，
          // 否则同一个数在一屏上印成 4.5% 和 4.46%
          marker={MARGIN_RATIO_DANGER}
          tone={riskText(marginRatioRisk(futures.margin_ratio).tone)}
          value={percent(futures.margin_ratio, 1)}
        />
      )}
      {margin?.margin_level != null && (
        <Gauge
          fill={Math.max(0, Math.min(1, (MARGIN_LEVEL_SAFE + 1 - margin.margin_level) / 2))}
          hint={marginLevelRisk(margin.margin_level).label}
          label="杠杆账户风险率"
          marker={(MARGIN_LEVEL_SAFE + 1 - MARGIN_LEVEL_WARN) / 2}
          tone={riskText(marginLevelRisk(margin.margin_level).tone)}
          value={margin.margin_level.toFixed(2)}
        />
      )}
      <div className="space-y-2 border-t border-rule pt-3.5">
        {exposureRatio !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>名义敞口 / 净值</Eyebrow>
            <span className="tnum text-sm text-ink-2">
              {exposureRatio.toFixed(2)}×<span className="text-ink-3"> · 真实杠杆</span>
            </span>
          </div>
        )}
        {concentration && (
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>最大单一敞口</Eyebrow>
            <span className="tnum text-sm text-ink-2">
              {percent(concentration.share, 1)}
              <span className="text-ink-3"> · {concentration.asset}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function PositionsList({ futures, unavailable }: {
  futures: FuturesAccount | null
  unavailable: boolean
}) {
  if (unavailable) {
    return <p className="py-10 text-center text-sm text-ink-3">合约数据本次没有取到。</p>
  }
  if (!futures || futures.positions.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">当前没有合约持仓。</p>
  }
  return (
    <ul>
      {futures.positions.map((position) => (
        <PositionRow key={`${position.symbol}-${position.position_side}`} position={position} />
      ))}
    </ul>
  )
}
