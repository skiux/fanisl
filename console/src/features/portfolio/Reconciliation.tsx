import { cn } from '../../lib/cn'
import { money, signedMoney, signedPercent } from '../../lib/format'
import type { Attribution } from '../../api/types'

type Line = {
  key: string
  label: string
  value: number
  /** 充提是中性事件，不是盈亏——单独一类，绝不能染成绿色 */
  kind: 'transfer' | 'flow'
}

/**
 * 本期变动。报表要的是能逐行核对的精确读数，所以主体是表而不是图；
 * 每行右侧配一条以零为轴的发散条，正向右、负向左，量级一眼可比。
 *
 * 恒等式：期末 = 期初 + 净充提 + 已实现 + 未实现变动 + 资金费 + 手续费
 */
function BarCell({ value, scale, kind }: { value: number; scale: number; kind: Line['kind'] }) {
  const ratio = scale > 0 ? Math.min(1, Math.abs(value) / scale) : 0
  const positive = value >= 0
  const tone =
    kind === 'transfer' ? 'bg-accent/60'
    : positive ? 'bg-gain/70' : 'bg-loss/70'

  return (
    <span aria-hidden="true" className="relative block h-[11px] w-full">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-rule-strong" />
      <span
        className={cn('absolute top-1/2 h-[9px] -translate-y-1/2 rounded-[1px] transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]', tone)}
        style={positive
          ? { left: '50%', width: `${Math.max(ratio * 50, 1.4).toFixed(2)}%` }
          : { right: '50%', width: `${Math.max(ratio * 50, 1.4).toFixed(2)}%` }}
      />
    </span>
  )
}

export function Reconciliation({ data, veiled }: { data: Attribution | null; veiled: boolean }) {
  if (!data) {
    return (
      <div className="border border-dashed border-rule px-5 py-8">
        <p className="text-sm text-ink-2">本期变动暂时算不出来</p>
        <p className="mt-2 max-w-[46ch] text-xs leading-relaxed text-ink-3">
          需要期初净值（日快照）、收支流水与充提记录同时可用。缺任一项，
          恒等式就不闭合——与其给一张对不上账的表，不如空着。
        </p>
      </div>
    )
  }

  const lines: Line[] = [
    { key: 'transfer', label: '净充提', value: data.net_transfer, kind: 'transfer' },
    { key: 'realized', label: '已实现盈亏', value: data.realized_pnl, kind: 'flow' },
    { key: 'unrealized', label: '未实现变动', value: data.unrealized_delta, kind: 'flow' },
    { key: 'funding', label: '资金费', value: data.funding_fee, kind: 'flow' },
    { key: 'commission', label: '手续费', value: data.commission, kind: 'flow' },
  ]
  const scale = Math.max(...lines.map((line) => Math.abs(line.value)), 1)

  return (
    <div className={cn(veiled && 'veiled')}>
      <table className="w-full border-collapse">
        <tbody>
          <tr className="border-b border-rule">
            <th className="py-2.5 text-left text-sm font-normal text-ink-2" scope="row">
              期初净值 <span className="tnum text-micro text-ink-3">{data.window_start}</span>
            </th>
            <td className="w-[176px] px-4" />
            <td className="tnum py-2.5 text-right text-sm text-ink">{money(data.opening_equity)}</td>
          </tr>

          {lines.map((line) => (
            <tr className="border-b border-rule/70" key={line.key}>
              <th className="py-2.5 pl-4 text-left text-sm font-normal text-ink-2" scope="row">
                {line.label}
              </th>
              <td className="w-[176px] px-4 align-middle">
                <BarCell kind={line.kind} scale={scale} value={line.value} />
              </td>
              <td className={cn(
                'tnum py-2.5 text-right text-sm',
                line.kind === 'transfer' ? 'text-accent'
                  : line.value >= 0 ? 'text-gain' : 'text-loss',
              )}>
                {signedMoney(line.value)}
              </td>
            </tr>
          ))}

          <tr className="rule-heavy">
            <th className="py-2.5 text-left text-sm font-medium text-ink" scope="row">期末净值</th>
            <td className="w-[176px] px-4" />
            <td className="tnum py-2.5 text-right text-base text-ink">{money(data.closing_equity)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3">
          <span className="label">真实盈亏 · 已剔除充提</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className={cn('tnum text-xl font-medium', data.true_pnl >= 0 ? 'text-gain' : 'text-loss')}>
            {signedMoney(data.true_pnl)}
          </span>
          <span className={cn('tnum text-sm', (data.true_return ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
            {signedPercent(data.true_return)}
          </span>
        </div>
      </div>
    </div>
  )
}
