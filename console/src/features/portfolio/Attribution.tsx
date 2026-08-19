import { useMemo } from 'react'
import { Info } from '@phosphor-icons/react'
import { Delta, Eyebrow, SectionHead } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, moneyCompact, signedMoney, signedPercent } from '../../lib/format'
import type { Attribution as AttributionData } from '../../api/types'

type Step = {
  key: string
  label: string
  value: number
  from: number
  to: number
  kind: 'anchor' | 'transfer' | 'flow'
}

function buildSteps(a: AttributionData): Step[] {
  const flows: Array<[string, string, number, Step['kind']]> = [
    ['transfer', '净充提', a.net_transfer, 'transfer'],
    ['realized', '已实现盈亏', a.realized_pnl, 'flow'],
    ['unrealized', '未实现变动', a.unrealized_delta, 'flow'],
    ['funding', '资金费', a.funding_fee, 'flow'],
    ['commission', '手续费', a.commission, 'flow'],
  ]
  const steps: Step[] = [{
    key: 'opening', label: `${a.window_days} 天前`, value: a.opening_equity,
    from: 0, to: a.opening_equity, kind: 'anchor',
  }]
  let running = a.opening_equity
  for (const [key, label, value, kind] of flows) {
    steps.push({ key, label, value, from: running, to: running + value, kind })
    running += value
  }
  steps.push({ key: 'closing', label: '当前', value: running, from: 0, to: running, kind: 'anchor' })
  return steps
}

function StepColumn({ step, floor, span }: { step: Step; floor: number; span: number }) {
  const top = Math.max(step.from, step.to)
  const bottom = Math.min(step.from, step.to)
  const anchor = step.kind === 'anchor'
  const levelPct = ((step.to - floor) / span) * 100
  const heightPct = Math.abs(step.to - step.from) / span * 100
  const bottomPct = ((bottom - floor) / span) * 100

  // 充提是中性事件，不是盈亏——绝不能染成绿色，否则"充钱进来"会被读成"赚了"
  const tone =
    step.kind === 'transfer' ? 'bg-accent/70'
    : step.value >= 0 ? 'bg-gain/75' : 'bg-loss/75'

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <span className={cn(
        'tnum whitespace-nowrap text-xs',
        anchor ? 'text-fg-2'
        : step.kind === 'transfer' ? 'text-accent'
        : step.value >= 0 ? 'text-gain' : 'text-loss',
      )}>
        {anchor ? moneyCompact(step.value) : signedMoney(step.value)}
      </span>

      <div className="relative w-full flex-1">
        {anchor ? (
          /*
            锚柱画成"水位"而不是"数量"：轴是缩放的，期初 74.2K 与当前 80.1K 只差 8%，
            按到轴底的距离画会得到 3.5 倍的柱高差，直接误导。
            所以只留极淡的底色 + 一条实心水位线，读者读的是那条线的高度。
          */
          <div
            className="absolute inset-x-[14%] bottom-0 border-x border-b border-line bg-fg-3/[0.06]"
            style={{ height: `${Math.max(levelPct, 2)}%` }}
          >
            <div className="absolute inset-x-0 top-0 h-[2px] bg-fg-3/70" />
          </div>
        ) : (
          <div
            className={cn(
              'absolute inset-x-[18%] rounded-[3px] transition-[height,bottom] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
              tone,
            )}
            style={{ bottom: `${bottomPct}%`, height: `${Math.max(heightPct, 1.2)}%` }}
          />
        )}
        {!anchor && (
          <div
            className="absolute inset-x-0 border-t border-dashed border-line-strong"
            style={{ bottom: `${((top - floor) / span) * 100}%` }}
          />
        )}
      </div>

      <span className="truncate text-center text-micro text-fg-3">{step.label}</span>
    </div>
  )
}

export function AttributionPanel({ data, veiled, embedded = false }: {
  data: AttributionData | null
  veiled: boolean
  embedded?: boolean
}) {
  const steps = useMemo(() => (data ? buildSteps(data) : []), [data])

  if (!data) {
    return (
      <section className={cn(embedded && 'flex min-h-full flex-col justify-center')}>
        {!embedded && <SectionHead label="归因 · Attribution" title="这段时间的钱从哪来" />}
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line px-5 py-10 text-center">
          <p className="text-sm text-fg-2">这一节暂时算不出来</p>
          <p className="mx-auto mt-2 max-w-[420px] text-xs leading-relaxed text-fg-3">
            归因需要期初净值（日快照）、收支流水与充提记录同时可用。缺任一项，
            恒等式就不闭合——与其给一张对不上账的图，不如空着。
          </p>
        </div>
      </section>
    )
  }

  const values = steps.flatMap((step) => [step.from, step.to]).filter((v) => v !== 0)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const pad = (high - low) * 0.18 || 1
  const floor = low - pad
  const span = high + pad * 0.4 - floor

  return (
    <section className={cn('flex min-h-full flex-col', veiled && 'veiled')}>
      {embedded ? (
        <div className="mb-5 flex items-center gap-1.5 text-xs text-fg-3">
          <Info size={13} />
          窗口固定 30 天：日快照接口只能查最近一个月
        </div>
      ) : (
        <SectionHead
          aside={
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              <Info size={13} />
              窗口固定 30 天：日快照接口只能查最近一个月
            </span>
          }
          label="归因 · Attribution"
          title="这段时间的钱从哪来"
        />
      )}

      <div className="mb-7 flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-line pb-6">
        <div>
          <Eyebrow>真实盈亏 · 已剔除充提</Eyebrow>
          <div className="mt-2 flex items-baseline gap-3">
            <Delta className="text-2xl font-medium tracking-tight" value={data.true_pnl}>
              {signedMoney(data.true_pnl)}
            </Delta>
            <Delta className="text-base" value={data.true_return}>
              {signedPercent(data.true_return)}
            </Delta>
          </div>
        </div>
        <p className="max-w-[380px] text-xs leading-relaxed text-fg-3">
          净值变化 {signedMoney(data.closing_equity - data.opening_equity)} 里有{' '}
          <span className="tnum text-fg-2">{signedMoney(data.net_transfer)}</span>{' '}
          是你自己转进转出的，不是赚的。
        </p>
      </div>

      <div className="flex min-h-[170px] flex-1 items-stretch gap-1 sm:gap-3">
        {steps.map((step) => (
          <StepColumn floor={floor} key={step.key} span={span} step={step} />
        ))}
      </div>

      <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-2.5 border-t border-line pt-5 sm:grid-cols-4">
        {([
          ['期初净值', money(data.opening_equity)],
          ['当前净值', money(data.closing_equity)],
          ['资金费累计', signedMoney(data.funding_fee)],
          ['手续费累计', signedMoney(data.commission)],
        ] as const).map(([label, value]) => (
          <div className="flex items-baseline justify-between gap-2" key={label}>
            <dt className="text-xs text-fg-3">{label}</dt>
            <dd className="tnum text-sm text-fg-2">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
