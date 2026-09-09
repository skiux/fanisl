import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { SegmentedControl } from '../../components/controls'
import { Ticker } from '../../components/Ticker'
import { DUST_THRESHOLD_USD, money, percent, signedMoney, signedPercent } from '../../lib/format'
import { cash, exposures } from '../../lib/holdings'
import { breakingDrop, shock } from '../../lib/stress'
import { marginRatioRisk, riskBar, riskText } from '../../lib/risk'
import type { PortfolioSnapshot } from '../../api/types'

/** 饼图最多画这么多块，其余并进「其他」——再多就成了一圈碎片 */
const PIE_SLICES = 6

/**
 * 一块饼的颜色。**按名次把色相摊开**，不用字母标记那套哈希色。
 *
 * 哈希色的好处是"同一个标的到哪儿都是同一个色"，可饼图要的恰恰相反：相邻两块
 * 必须一眼分得开。六个色相哈希下来，四块大的很可能挤在同一段蓝里——第一版画出来
 * 就是一圈深浅不一的蓝。名次摊开保证任意两块至少差二十来度，再叠一点明度递减。
 *
 * 色带仍然避开 gain / loss / accent（绿 155°、红 30°、黄铜 85°）：这一块旁边就是
 * 带正负号的金额，一块偏红的扇区会被读成"亏了"。
 */
const sliceColor = (rank: number, count: number) => {
  const hue = 192 + (count <= 1 ? 64 : (rank * 128) / (count - 1))
  return `oklch(${(0.68 - rank * 0.028).toFixed(3)} 0.115 ${hue.toFixed(0)})`
}

const DROPS = { '10': 0.1, '20': 0.2, '30': 0.3, '50': 0.5 } as const
const LEVERAGES = { '1': 1, '2': 2, '3': 3, '5': 5, '10': 10 } as const

/**
 * 风险控制。原先这些东西散在两处：总览的「风险仪表」是三个此刻的读数，
 * 合约页是逐个仓位的距强平。**两处都回答不了"再跌多少我出局"**——
 * 逐个仓位各看各的距离，而账户是共用一份保证金的，多个仓位一起亏才是真实情形，
 * 分开看会系统性地低估。
 *
 * 四块，从"现在怎样"走到"还能扛多少"：
 *
 *   临界跌幅   一起跌多少开始强平；补上现金之后又是多少
 *   敞口分布   按标的合并现货与永续之后，钱压在哪几个东西上
 *   压力测试   选一个跌幅，看净值 / 保证金率 / 可用余额 / 谁会被强平
 *   现金缓冲   还能往合约里补多少
 *
 * **敞口分布没做成饼图。** 饼图在两件事上不好用，而这两件恰好都是这里要做的：
 * 比较大小接近的扇区（角度差几度看不出来），以及处理长尾（十个小仓位挤成一圈碎片）。
 * 排序过的横条直接按长度比，小的排在后面也读得出来。更要紧的是**饼图画不了负数**，
 * 而这里的空头名义是负的——它抵掉同一标的的现货，那才是真实敞口。
 */
export function RiskControlView({ snapshot, veiled }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
}) {
  const [drop, setDrop] = useState<keyof typeof DROPS>('30')
  const [lever, setLever] = useState<keyof typeof LEVERAGES>('3')

  const equity = snapshot.totals?.equity_usd ?? 0
  const rows = useMemo(() => exposures(snapshot, equity), [snapshot, equity])
  const cashRows = useMemo(() => cash(snapshot), [snapshot])
  // 现货钱包里的稳定币才是**随时能划进合约**的那部分：理财要赎回、
  // 合约里的那份本来就已经是保证金了
  const sumWhere = (test: (where: string) => boolean) => cashRows
    .filter((row) => test(row.where))
    .reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
  const spare = sumWhere((where) => where === '现货')
  const parked = sumWhere((where) => where.startsWith('理财'))
  const asMargin = sumWhere((where) => where === '合约保证金')
  const cashTotal = cashRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)

  const hit = useMemo(() => shock(snapshot, DROPS[drop]), [snapshot, drop])
  const edge = useMemo(() => breakingDrop(snapshot), [snapshot])
  const edgeWithCash = useMemo(() => breakingDrop(snapshot, spare), [snapshot, spare])

  // **饼只画多头**：现货 + 合约多头名义。空头是负的，饼画不了负数；稳定币是现金
  // 不是敞口（`exposures` 已经把它排除了）。这和底下的横条不是同一个数——
  // 横条是净敞口（空头抵掉现货），饼回答的是"钱压在哪几个东西上"。
  const longs = rows
    .map((row) => ({
      asset: row.asset,
      value: Math.max(0, row.spot_usd) + Math.max(0, row.perp_usd),
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
  const longTotal = longs.reduce((sum, row) => sum + row.value, 0)
  // 先按占比砍再按名次封顶：只封顶的话，0.2% 的 ETH 会自己占一块，
  // 而它比旁边那个「其他」还小——一圈里挤着三块看不见的扇区
  const shown = longs
    .filter((row) => longTotal > 0 && row.value / longTotal >= 0.01)
    .slice(0, PIE_SLICES)
  const slices = [...shown]
  const rest = longTotal - shown.reduce((sum, row) => sum + row.value, 0)
  if (rest > longTotal * 0.001) slices.push({ asset: '其他', value: rest })

  const netExposure = rows.reduce((sum, row) => sum + row.net_usd, 0)
  // 灰尘不占行：这一页问的是"哪几个东西会伤到我"，$7 的 DOGE 不是答案，
  // 而十来行尘埃会把真正的几个大头挤到看不见
  const major = rows.filter((row) => Math.abs(row.net_usd) >= DUST_THRESHOLD_USD)
  const dust = rows.filter((row) => Math.abs(row.net_usd) < DUST_THRESHOLD_USD)
  const dustValue = dust.reduce((sum, row) => sum + row.net_usd, 0)
  const peak = Math.max(...major.map((row) => Math.abs(row.net_usd)), 1)
  const multiplier = LEVERAGES[lever]

  if (snapshot.futures === null && rows.length === 0) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module span="lg:col-span-7" title="没有可评估的风险">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              这一节要的是仓位与保证金，两样这次都没有。
            </p>
          </Module>
        </ViewGrid>
      </div>
    )
  }

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={edge === null ? '—' : percent(edge, 1)}
          note="一起跌到这里开始强平"
          span="lg:col-span-4"
          title="临界跌幅"
          tone={edge === null ? 'muted' : edge < 0.15 ? 'loss' : undefined}
        >
          {edge === null ? (
            <p className="text-sm text-ink-3">当前的仓位组合不会因为普跌而强平。</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="现在" value={percent(edge, 1)} />
              <Figure
                label="补上现货现金后"
                note={spare > 0 ? money(spare) : undefined}
                value={edgeWithCash === null ? '不会强平' : percent(edgeWithCash, 1)}
              />
              <Figure
                label="维持保证金"
                value={snapshot.futures === null ? '—' : money(snapshot.futures.total_maint_margin)}
              />
              <Figure
                label="保证金余额"
                value={snapshot.futures === null ? '—' : money(snapshot.futures.total_margin_balance)}
              />
            </dl>
          )}
        </Module>

        <Module
          figure={signedMoney(netExposure)}
          note={`净敞口 · ${rows.length} 个标的`}
          span="lg:col-span-8"
          title="敞口分布"
        >
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">当前没有敞口。</p>
          ) : (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <Donut slices={slices} total={longTotal} />
            <ul className="min-w-0 flex-1 divide-y divide-rule">
              {major.map((row) => (
                <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5" key={row.asset}>
                  <span className="flex items-center gap-2.5">
                    <Ticker asset={row.asset} size="sm" />
                    <span className="w-[52px] shrink-0 truncate text-sm text-ink">{row.asset}</span>
                  </span>
                  {/* 零点在中间：空头往左、多头往右，多空对锁的标的一眼看得出
                      两边都短。饼图做不到这件事——它画不了负数。 */}
                  <span className="relative block h-[5px] rounded-full bg-rule">
                    <span
                      className={cn('absolute top-0 block h-full rounded-full transition-[width] duration-500',
                        row.net_usd >= 0 ? 'left-1/2 bg-ink-3' : 'right-1/2 bg-accent')}
                      style={{ width: `${(Math.abs(row.net_usd) / peak * 50).toFixed(1)}%` }}
                    />
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="tnum w-[92px] text-right text-sm text-ink">
                      {signedMoney(row.net_usd)}
                    </span>
                    <span className="tnum w-[44px] text-right text-xs text-ink-3">
                      {percent(row.share, 1)}
                    </span>
                  </span>
                </li>
              ))}
              {dust.length > 0 && (
                <li className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="text-xs text-ink-3">{dust.length} 项灰尘敞口</span>
                  <span className="tnum text-xs text-ink-3">{signedMoney(dustValue)}</span>
                </li>
              )}
            </ul>
            </div>
          )}
        </Module>

        <Module
          figure={hit.equity_usd === null ? '—' : money(hit.equity_usd)}
          note={`跌 ${drop}% 之后的净值`}
          span="lg:col-span-8"
          title="压力测试"
          tone={hit.liquidated.length > 0 ? 'loss' : undefined}
        >
          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <SegmentedControl
              items={(Object.keys(DROPS) as (keyof typeof DROPS)[])
                .map((k) => ({ value: k, label: `跌 ${k}%` }))}
              label="下跌幅度"
              onValueChange={setDrop}
              size="sm"
              value={drop}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
            <Figure
              label="净值"
              tone="loss"
              value={hit.equity_usd === null ? '—' : money(hit.equity_usd)}
              note={equity > 0 && hit.equity_usd !== null
                ? signedPercent(hit.equity_usd / equity - 1, 1) : undefined}
            />
            <Figure
              label="合约未实现"
              tone={(hit.unrealized_usd ?? 0) >= 0 ? 'gain' : 'loss'}
              value={hit.unrealized_usd === null ? '—' : signedMoney(hit.unrealized_usd)}
            />
            <Figure
              label="保证金率"
              tone={hit.margin_ratio !== null && hit.margin_ratio >= 0.8 ? 'loss' : undefined}
              value={hit.margin_ratio === null ? '—' : percent(hit.margin_ratio, 1)}
              note={hit.margin_ratio === null ? undefined : marginRatioRisk(hit.margin_ratio).label}
            />
            <Figure
              label="可用余额"
              tone={(hit.available_usd ?? 0) < 0 ? 'loss' : undefined}
              value={hit.available_usd === null ? '—' : money(Math.max(0, hit.available_usd))}
            />
          </dl>

          {hit.margin_ratio !== null && (
            <div className="mt-5 flex items-center gap-3">
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-rule">
                <span
                  className={cn('block h-full rounded-full transition-[width] duration-700',
                    riskBar(marginRatioRisk(hit.margin_ratio).tone))}
                  style={{ width: `${Math.min(100, hit.margin_ratio * 100).toFixed(1)}%` }}
                />
              </span>
              <span className={cn('tnum shrink-0 text-xs',
                riskText(marginRatioRisk(hit.margin_ratio).tone))}>
                {percent(hit.margin_ratio, 1)}
              </span>
            </div>
          )}

          {hit.liquidated.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
              {hit.liquidated.map((symbol) => (
                <li
                  className="rounded-[4px] border border-loss/40 px-2 py-1 text-xs text-loss"
                  key={symbol}
                >
                  {symbol} 触及强平价
                </li>
              ))}
            </ul>
          )}
        </Module>

        <Stack span="lg:col-span-4">
          <Module
            figure={`${multiplier}×`}
            note="以这个杠杆还能开多少"
            span=""
            title="可开仓位"
          >
            <div className="mb-5">
              <SegmentedControl
                items={(Object.keys(LEVERAGES) as (keyof typeof LEVERAGES)[])
                  .map((k) => ({ value: k, label: `${k}×` }))}
                label="杠杆"
                onValueChange={setLever}
                size="sm"
                value={lever}
              />
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure
                label="现在"
                value={snapshot.futures === null ? '—'
                  : money(Math.max(0, snapshot.futures.available_balance) * multiplier)}
              />
              <Figure
                label={`跌 ${drop}% 之后`}
                tone="loss"
                value={hit.available_usd === null ? '—'
                  : money(Math.max(0, hit.available_usd) * multiplier)}
              />
              <Figure
                label="可用余额"
                value={snapshot.futures === null ? '—' : money(snapshot.futures.available_balance)}
              />
              <Figure label="现货现金" value={money(spare)} />
            </dl>
          </Module>

          {/* 逐行的现金明细在「持仓」页，这里只回答"还能补多少保证金"——
              按**能不能马上划过去**分三档，那才是这一页要的切法。 */}
          <Module
            figure={money(cashTotal)}
            note="全部稳定币"
            span=""
            title="现金缓冲"
          >
            {cashRows.length === 0 ? (
              <p className="text-sm text-ink-3">账户里没有稳定币。</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Figure label="现货 · 可直接划转" value={money(spare)} />
                <Figure label="理财 · 要先赎回" value={money(parked)} />
                <Figure label="已经是保证金" value={money(asMargin)} />
                <Figure
                  label="占净值"
                  value={percent(equity > 0 ? cashTotal / equity : null, 1)}
                />
              </dl>
            )}
          </Module>
        </Stack>
      </ViewGrid>
    </div>
  )
}


/**
 * 多头敞口的构成。**只画正数**：空头是负的，饼画不了负数——那正是横条还留着的
 * 理由，两者回答的不是同一个问题（饼：钱压在哪几个东西上；横条：价格动一下
 * 账户净暴露多少，空头会抵掉现货）。
 *
 * 手写 SVG 而不是引图表库：一个圆环用 `stroke-dasharray` 就是十行，
 * 而图表库的默认样式（网格线、提示框、图例）全要推翻重来。
 */
function Donut({ slices, total }: { slices: { asset: string; value: number }[]; total: number }) {
  const R = 38
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex shrink-0 items-center gap-5 sm:w-[212px] sm:flex-col sm:items-stretch sm:gap-4">
      <svg
        aria-hidden="true"
        className="size-[104px] shrink-0 -rotate-90 sm:mx-auto sm:size-[132px]"
        viewBox="0 0 100 100"
      >
        {slices.map((slice, i) => {
          const len = total > 0 ? (slice.value / total) * C : 0
          const dash = `${len} ${C - len}`
          const node = (
            <circle
              cx="50"
              cy="50"
              fill="none"
              key={slice.asset}
              r={R}
              stroke={sliceColor(i, slices.length)}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              // 细缝把相邻两块分开，不靠描边——描边在深色纸上会变成一圈亮线
              strokeWidth={i === 0 ? 15 : 14}
            />
          )
          offset += len
          return node
        })}
      </svg>

      <div className="min-w-0 flex-1">
        {/* 这个合计和模块抬头那个「净敞口」不是同一个数：那个含空头（是负的），
            这里只有多头。不写出来的话，会以为饼是照着抬头那个数分的。 */}
        <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
          <span className="text-micro text-ink-3">多头合计</span>
          <span className="tnum text-xs text-ink-2">{money(total)}</span>
        </div>
        <ul className="space-y-1.5">
        {slices.map((slice, i) => (
          <li className="flex items-baseline gap-2" key={slice.asset}>
            <span
              className="size-2 shrink-0 translate-y-px rounded-[2px]"
              style={{ background: sliceColor(i, slices.length) }}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{slice.asset}</span>
            <span className="tnum shrink-0 text-xs text-ink-3">
              {percent(total > 0 ? slice.value / total : null, 1)}
            </span>
          </li>
        ))}
        </ul>
      </div>
    </div>
  )
}
