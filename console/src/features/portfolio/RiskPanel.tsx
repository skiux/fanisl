import { ArrowDown, ArrowUp, Lightning } from '@phosphor-icons/react'
import { Delta, Eyebrow, SectionHead } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import type { FuturesAccount, FuturesPosition, MarginAccount } from '../../api/types'

function marginTone(ratio: number) {
  if (ratio < 0.3) return { bar: 'bg-gain', text: 'text-gain', label: '安全' }
  if (ratio < 0.6) return { bar: 'bg-accent', text: 'text-accent', label: '偏紧' }
  return { bar: 'bg-loss', text: 'text-loss', label: '危险' }
}

/** 杠杆账户的 marginLevel 语义与合约相反：越小越危险，< 1.3 预警、< 1.1 强平 */
function marginLevelTone(level: number) {
  if (level >= 2) return { text: 'text-gain', label: '安全' }
  if (level >= 1.3) return { text: 'text-accent', label: '偏紧' }
  return { text: 'text-loss', label: '接近强平' }
}

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
        <span className={cn('tnum text-sm', tone)}>{value} <span className="text-fg-3">· {hint}</span></span>
      </div>
      <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]', tone.replace('text-', 'bg-'))}
          style={{ width: `${Math.min(100, Math.max(0, fill * 100)).toFixed(1)}%` }}
        />
        {marker !== undefined && (
          <span className="absolute inset-y-0 w-px bg-fg-3/60" style={{ left: `${marker * 100}%` }} />
        )}
      </div>
    </div>
  )
}

function AdlPips({ quantile }: { quantile: number | null }) {
  if (quantile === null) return null
  return (
    <span className="flex items-center gap-1" title={`自动减仓排队分位 ${quantile}/4`}>
      <Lightning className={quantile >= 3 ? 'text-loss' : 'text-fg-3'} size={10} weight="fill" />
      <span className="flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((step) => (
          <i
            className={cn(
              'h-[7px] w-[3px] rounded-[1px]',
              step < quantile ? (quantile >= 3 ? 'bg-loss' : 'bg-fg-3') : 'bg-line-strong',
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
  // 距强平越近条越满：与保证金率同向，"变满 = 变危险"
  const risk = distance === null ? 0 : Math.max(0, Math.min(1, 1 - distance / 0.5))

  return (
    <li className="py-4 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">{position.symbol}</span>
            {/* 方向用中性色 + 箭头：绿/红在这个界面里只表示盈亏 */}
            <span className="flex items-center gap-1 rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-wider text-fg-2">
              {long ? <ArrowUp size={9} weight="bold" /> : <ArrowDown size={9} weight="bold" />}
              {long ? 'Long' : 'Short'}
            </span>
            <AdlPips quantile={position.adl_quantile} />
          </div>
          <div className="tnum mt-1 text-xs text-fg-3">
            {position.leverage}× · {position.isolated ? '逐仓' : '全仓'} · {money(position.notional_usd)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Delta className="text-sm" value={position.unrealized_pnl_usd}>
            {signedMoney(position.unrealized_pnl_usd)}
          </Delta>
          <div className="tnum text-xs text-fg-3">{signedPercent(pnlPct)}</div>
        </div>
      </div>

      <dl className="tnum mt-3 grid grid-cols-3 gap-x-3 text-xs">
        {([
          ['开仓', price(position.entry_price)],
          ['标记', price(position.mark_price)],
          ['强平', price(position.liquidation_price)],
        ] as const).map(([label, value]) => (
          <div className="min-w-0 whitespace-nowrap" key={label}>
            <dt className="text-fg-3">{label}</dt>
            <dd className="truncate text-fg-2">{value}</dd>
          </div>
        ))}
      </dl>

      {distance !== null && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <span
              className={cn('block h-full rounded-full transition-[width] duration-700',
                risk > 0.6 ? 'bg-loss' : risk > 0.3 ? 'bg-accent' : 'bg-fg-3')}
              style={{ width: `${(risk * 100).toFixed(1)}%` }}
            />
          </span>
          <span className="tnum shrink-0 text-xs text-fg-3">距强平 {percent(distance, 1)}</span>
        </div>
      )}
    </li>
  )
}

export function RiskPanel({
  futures, margin, exposureRatio, veiled, unavailable,
}: {
  futures: FuturesAccount | null
  margin: MarginAccount | null
  exposureRatio: number | null
  veiled: boolean
  unavailable: boolean
}) {
  return (
    <section className={cn(veiled && 'veiled')}>
      <SectionHead label="风险 · Exposure" title="有没有危险" />

      {unavailable ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-9 text-center">
          <p className="text-sm text-fg-2">合约数据本次没有取到</p>
          <p className="mt-2 text-xs leading-relaxed text-fg-3">
            保证金率与强平距离都算不出来，这一节不猜。
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-5 rounded-[var(--radius-panel)] bg-surface-2 px-4 py-4">
            {futures?.margin_ratio !== undefined && futures?.margin_ratio !== null && (
              <Gauge
                fill={futures.margin_ratio}
                hint={marginTone(futures.margin_ratio).label}
                label="合约保证金率"
                marker={0.8}
                tone={marginTone(futures.margin_ratio).text}
                value={percent(futures.margin_ratio, 2)}
              />
            )}
            {margin?.margin_level != null && (
              <Gauge
                fill={Math.max(0, Math.min(1, (3 - margin.margin_level) / 2))}
                hint={marginLevelTone(margin.margin_level).label}
                label="杠杆账户风险率"
                marker={(3 - 1.3) / 2}
                tone={marginLevelTone(margin.margin_level).text}
                value={margin.margin_level.toFixed(2)}
              />
            )}
            {exposureRatio !== null && (
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-4">
                <Eyebrow>名义敞口 / 净值</Eyebrow>
                <span className="tnum text-sm text-fg-2">
                  {exposureRatio.toFixed(2)}×
                  <span className="text-fg-3"> · 真实杠杆</span>
                </span>
              </div>
            )}
          </div>

          {futures && futures.positions.length > 0 ? (
            <ul className="mt-5 divide-y divide-line">
              {futures.positions.map((position) => (
                <PositionRow key={`${position.symbol}-${position.position_side}`} position={position} />
              ))}
            </ul>
          ) : (
            <p className="mt-5 rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-8 text-center text-sm text-fg-2">
              当前没有合约持仓
            </p>
          )}
        </>
      )}
    </section>
  )
}
