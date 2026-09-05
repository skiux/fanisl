import { cn } from '../../lib/cn'
import { price, signedMoney } from '../../lib/format'
import type { Pnl } from '../../api/types'

/**
 * 盈亏构成。**每一行都有出处，没有残差项。**
 *
 * 原先这里是一张归因表：期末 − 期初 − 净充提，剩下的靠残差反解"未实现变动"。
 * 那个残差会把一切口径错误照单全收——包括钱包之间的划转，所以它算出来的
 * "未实现变动"里混着充提。表面上瀑布永远闭合，错了也看不出来。
 *
 * 三块的窗口不一样，是接口的硬限，不是选择。所以**不加成一个总数**：
 * "现货全历史 + 合约 90 天"加起来不是任何一个真实区间的成绩。
 */
export function PnlBreakdown({ pnl }: { pnl: Pnl | null }) {
  if (!pnl) {
    return (
      <p className="py-10 text-sm text-ink-3">
        成交记录取不到，盈亏算不出来。这里不拿资产变化倒推——钱包之间的划转会被算成盈亏。
      </p>
    )
  }

  // 每行只有标签和数字。窗口与出处收进摘要条那三个数字的详情抽屉里——
  // 常驻在这里的话，七行小字比数字本身还占地方，而它们 99% 的时间没人看。
  const rows: { label: string; value: number | null }[] = [
    // 现货这一行是**今天的涨跌**，不是相对成本的未实现——后者要完整的买入历史，
    // 而划转 / 派息 / 小额兑换进来的币在成交记录里没有痕迹，那段历史补不齐。
    { label: '现货今日盯市', value: pnl.today.spot_mark_usd },
    { label: '合约未实现', value: pnl.unrealized.futures_usd },
    { label: '现货已实现', value: pnl.realized.spot_usd },
    { label: '合约已实现', value: pnl.realized.futures_usd },
    { label: '资金费', value: pnl.carry.funding_usd },
    { label: '手续费', value: pnl.carry.commission_usd },
    { label: '返佣', value: pnl.carry.referral_usd },
  ]
  const scale = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), 1)

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

      {/* 覆盖范围与"哪个币算不出来"都在详情抽屉里，这里不重复一遍 */}

      {pnl.spot_marks.length > 0 && (
        <div className="mt-6 border-t border-rule pt-4">
          <p className="label mb-2.5">现货今日</p>
          <ul className="divide-y divide-rule/70">
            {pnl.spot_marks.map((row) => (
              <li className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2" key={row.asset}>
                <span className="text-sm text-ink-2">{row.asset}</span>
                <span className="tnum text-xs text-ink-3">
                  {price(row.prev_close_usd)} → {price(row.price_usd)}
                </span>
                <span className={cn('tnum text-right text-sm',
                  row.today_usd === null ? 'text-ink-3'
                    : row.today_usd >= 0 ? 'text-gain' : 'text-loss')}>
                  {row.today_usd === null ? '—' : signedMoney(row.today_usd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
