import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { Delta, Eyebrow, SectionHead } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import type { FuturesRisk, Position } from '../../api/types'

/** 强平距离：真正决定"要不要现在处理"的数字，比未实现盈亏更该被看见 */
function liquidationDistance(position: Position) {
  if (position.liquidation_price === null || position.mark_price <= 0) return null
  return Math.abs(position.mark_price - position.liquidation_price) / position.mark_price
}

function riskTone(ratio: number) {
  if (ratio < 0.5) return { bar: 'bg-gain', text: 'text-gain', label: '安全' }
  if (ratio < 0.8) return { bar: 'bg-accent', text: 'text-accent', label: '偏紧' }
  return { bar: 'bg-loss', text: 'text-loss', label: '危险' }
}

function MarginMeter({ risk }: { risk: FuturesRisk }) {
  const ratio = risk.margin_ratio
  if (ratio === null) {
    return <p className="text-[12.5px] text-fg-3">保证金率取不到。</p>
  }
  const tone = riskTone(ratio)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Eyebrow>保证金率</Eyebrow>
        <span className={cn('tnum text-[13px]', tone.text)}>
          {percent(ratio, 2)} <span className="text-fg-3">· {tone.label}</span>
        </span>
      </div>
      <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]', tone.bar)}
          style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
        />
        {/* 80% 是强平前的实际警戒线，标出来比只给个百分比有用 */}
        <span className="absolute inset-y-0 left-[80%] w-px bg-fg-3/55" />
      </div>
      <dl className="mt-3 flex justify-between text-[11.5px]">
        <div className="flex gap-1.5">
          <dt className="text-fg-3">保证金余额</dt>
          <dd className="tnum text-fg-2">{money(risk.margin_balance_usd)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-fg-3">维持保证金</dt>
          <dd className="tnum text-fg-2">{money(risk.maintenance_margin_usd)}</dd>
        </div>
      </dl>
    </div>
  )
}

function PositionRow({ position }: { position: Position }) {
  const distance = liquidationDistance(position)
  const pnlPct = position.initial_margin_usd > 0
    ? position.unrealized_pnl_usd / position.initial_margin_usd
    : null
  const long = position.side === 'long'
  // 距强平越近条越满：视觉上"变满=变危险"，和保证金率同向
  const fill = distance === null ? 0 : Math.max(0, Math.min(1, 1 - distance / 0.5))

  return (
    <li className="py-4 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] text-fg">
              {position.symbol.replace(':USDT', '')}
            </span>
            {/* 方向用中性色 + 箭头表达。绿/红在这个界面里只表示盈亏，
                不能同时又表示多空——否则"绿徽章配红数字"会让人读两遍。 */}
            <span className="flex items-center gap-1 rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-wider text-fg-2">
              {long ? <ArrowUp size={9} weight="bold" /> : <ArrowDown size={9} weight="bold" />}
              {long ? 'Long' : 'Short'}
            </span>
          </div>
          <div className="tnum mt-1 text-[11.5px] text-fg-3">
            {position.leverage}× · {position.margin_mode === 'cross' ? '全仓' : '逐仓'} · {money(position.notional_usd)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Delta className="text-[13.5px]" value={position.unrealized_pnl_usd}>
            {signedMoney(position.unrealized_pnl_usd)}
          </Delta>
          <div className="tnum text-[11.5px] text-fg-3">{signedPercent(pnlPct)}</div>
        </div>
      </div>

      <dl className="tnum mt-3 grid grid-cols-3 gap-x-3 text-[11.5px]">
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
              className={cn('block h-full rounded-full transition-[width] duration-700', fill > 0.6 ? 'bg-loss' : fill > 0.3 ? 'bg-accent' : 'bg-fg-3')}
              style={{ width: `${(fill * 100).toFixed(1)}%` }}
            />
          </span>
          <span className="tnum shrink-0 text-[11px] text-fg-3">距强平 {percent(distance, 1)}</span>
        </div>
      )}
    </li>
  )
}

export function PositionsPanel({
  positions, risk, veiled, unavailable,
}: {
  positions: Position[]
  risk: FuturesRisk | null
  veiled: boolean
  unavailable: boolean
}) {
  return (
    <section className={cn('rise', veiled && 'veiled')} style={{ '--i': 4 } as CSSProperties}>
      <SectionHead
        aside={positions.length > 0 ? <span className="tnum text-[12px] text-fg-3">{positions.length} 笔</span> : undefined}
        label="合约 · Perpetuals"
        title="仓位与风险"
      />

      {unavailable ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-8 text-center">
          <p className="text-[13px] text-fg-2">合约数据本次没有取到</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
            上方净值只统计了现货，不代表账户全部。
          </p>
        </div>
      ) : positions.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-8 text-center">
          <p className="text-[13px] text-fg-2">当前没有持仓</p>
          <p className="mt-1.5 text-[11.5px] text-fg-3">合约钱包里的余额已计入净值。</p>
        </div>
      ) : (
        <>
          {risk && (
            <div className="mb-5 rounded-[var(--radius-panel)] bg-surface-2 px-4 py-3.5">
              <MarginMeter risk={risk} />
            </div>
          )}
          <ul className="divide-y divide-line">
            {positions.map((position) => (
              <PositionRow key={position.symbol} position={position} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
