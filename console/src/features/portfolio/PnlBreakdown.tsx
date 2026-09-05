import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { Pnl } from '../../api/types'

/**
 * 合约这 90 天的收支构成。**四行同一个窗口、同一个来源，所以条形可比。**
 *
 * 上一版叫「盈亏构成」，七行混着四种窗口：现货今日涨跌（1 天）、合约未实现（此刻）、
 * 现货已实现（**全历史**）、合约已实现与资金费手续费（90 天）。条形是让人比较长短的，
 * 而这些数根本不在一个尺度上——`+$3,847`（90 天）旁边摆着 `+$127`（今天），
 * 比出来的东西没有意义。
 *
 * 拆掉之后各归各位：
 *
 * - **现货涨跌归日历**：那里本来就按选中的区间求和，也是唯一有区间概念的地方。
 * - **合约未实现归摘要条**：它是"此刻"，没有窗口，摘要条上已经有一格。
 * - **现货已实现删掉**：它是"相对终身加权平均成本"的结转，和早先删掉的「现货
 *   未实现」是同一个数的两半，依赖同一个算不准的成本。买入历史缺一块（划转 /
 *   派息 / 小额兑换进来的币在 `myTrades` 里没有痕迹），均价就偏，卖出结转跟着偏。
 *   卖得比重放看到的还多时能被识破（那个币会被标成成本不明），可**买得比看到的多、
 *   卖得不多时无声出错**——报一个看不出错的数比不报更糟。
 *
 * 剩下这四行全部来自 `/fapi/v1/income`，同一个 90 天窗口（接口硬限），
 * 加起来正好是这段时间合约结算掉的钱。
 */
export function PnlBreakdown({ pnl }: { pnl: Pnl | null }) {
  const rows: { label: string; value: number | null }[] = [
    { label: '已实现盈亏', value: pnl?.realized.futures_usd ?? null },
    { label: '资金费', value: pnl?.carry.funding_usd ?? null },
    { label: '手续费', value: pnl?.carry.commission_usd ?? null },
    { label: '返佣', value: pnl?.carry.referral_usd ?? null },
  ]
  const known = rows.filter((row) => row.value !== null)

  if (known.length === 0) {
    return <p className="py-10 text-sm text-ink-3">合约收支取不到。</p>
  }

  const scale = Math.max(...known.map((row) => Math.abs(row.value ?? 0)), 1)
  const total = known.reduce((sum, row) => sum + (row.value ?? 0), 0)

  return (
    <>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-rule/70" key={row.label}>
              <th className="py-2.5 text-left text-sm font-normal text-ink-2" scope="row">
                {row.label}
              </th>
              <td className="w-[140px] px-4 align-middle">
                {row.value !== null && <Bar scale={scale} value={row.value} />}
              </td>
              <td className={cn('tnum py-2.5 text-right text-sm',
                row.value === null ? 'text-ink-3'
                  : row.value >= 0 ? 'text-gain' : 'text-loss')}>
                {row.value === null ? '取不到' : signedMoney(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 四行同窗口同来源，加得起来——这是拆掉旧表之后才成立的 */}
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <span className="text-sm text-ink">合计</span>
        <span className={cn('tnum text-base', total >= 0 ? 'text-gain' : 'text-loss')}>
          {signedMoney(total)}
        </span>
      </div>
    </>
  )
}

function Bar({ value, scale }: { value: number; scale: number }) {
  const width = `${(Math.abs(value) / scale * 50).toFixed(1)}%`
  return (
    // 零点在中间：正负各占一半，一眼能看出哪几项是往外流的
    <span className="relative block h-[3px] bg-rule">
      <span
        className={cn('absolute top-0 block h-full',
          value >= 0 ? 'left-1/2 bg-gain' : 'right-1/2 bg-loss')}
        style={{ width }}
      />
    </span>
  )
}
