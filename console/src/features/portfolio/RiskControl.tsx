import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { Donut, Swatch, type DonutSlice } from '../../components/Donut'
import { SegmentedControl } from '../../components/controls'
import { Ticker } from '../../components/Ticker'
import {
  money, percent, signedMoney, signedPercent,
} from '../../lib/format'
import { cash, exposures } from '../../lib/holdings'
import { breakingDrop, resize, shock } from '../../lib/stress'
import { marginRatioRisk, riskBar, riskText } from '../../lib/risk'
import type { PortfolioSnapshot } from '../../api/types'

/** 饼图最多画这么多块，其余并进「其他」——再多就成了一圈碎片 */
const PIE_SLICES = 6

/**
 * 一块饼的底色。顺序色阶，定义在 `index.css` 的 `--pie-1..6`（深浅两套方向相反，
 * 理由写在那里）。不给每块一个"自己的颜色"是因为能用的色相不够——绿、红、黄铜
 * 已被盈亏与充提占死；识别哪块是谁交给块里的代码与金额，色只管排序和分块。
 */
const sliceInk = (rank: number, asset: string) =>
  (asset === '其他' ? 'var(--rule-strong)' : `var(--pie-${Math.min(rank + 1, 6)})`)

const DROPS = { '10': 0.1, '20': 0.2, '30': 0.3, '50': 0.5 } as const
const LEVERAGES = { '1': 1, '2': 2, '3': 3, '5': 5, '10': 10 } as const

/**
 * 压力测试用的仓位规模。`now` = 现在这套仓位；其余是"**如果把仓位开到 N 倍
 * 真实杠杆**"——按现价重新建仓（见 `stress.resize`），再往下跌。
 *
 * 有这一档是因为"现在安全"回答不了"我打算加到 2 倍，那时候还安不安全"，
 * 而后者才是要在加仓**之前**知道的。
 */
const SIZES = { now: null, '1': 1, '1.5': 1.5, '2': 2 } as const
type SizeKey = keyof typeof SIZES

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
  // **饼和右边那张表共用一个"正在看哪个标的"。** 两者是同一批标的的两种读法
  // （饼是多头、表是净敞口），指着其中一个而另一个没反应，等于把它们当成两张图。
  // `pinned` 给触屏和"想挪开鼠标继续读"用：没有 hover 的设备只能靠点。
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const focus = hover ?? pinned

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

  const [size, setSize] = useState<SizeKey>('now')
  // 先把仓位调到设定的规模，再施加下跌。两步分开，`resize` 与 `shock` 各自可测
  const staged = useMemo(() => {
    const target = SIZES[size]
    return target === null ? snapshot : resize(snapshot, target)
  }, [snapshot, size])
  const hit = useMemo(() => shock(staged, DROPS[drop]), [staged, drop])
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
  const slices: DonutSlice[] = shown.map((row, i) => ({
    key: row.asset, value: row.value, color: sliceInk(i, row.asset),
  }))
  // 折进「其他」的那几个块上写不下，**去处是右边那张表**——它列全部标的，
  // 一个都不折。图不该靠 hover 才说得全，也不该靠两处各抄一遍。
  const rest = longs.filter((row) => !shown.includes(row))
    .reduce((sum, row) => sum + row.value, 0)
  if (rest > longTotal * 0.001) {
    slices.push({ key: '其他', value: rest, color: sliceInk(slices.length, '其他') })
  }
  // 表里靠色块和环对号：本身有一块的用自己的色，被并进「其他」的用「其他」的色。
  // **不能留空**——留空就等于"这一行在图上找不到"，而它其实在，只是并进去了。
  const other = slices.find((slice) => slice.key === '其他')?.color ?? null
  const swatchOf = (asset: string) =>
    slices.find((slice) => slice.key === asset)?.color
    ?? (longs.some((row) => row.asset === asset) ? other : null)

  const shownSlice = slices.find((slice) => slice.key === focus) ?? null
  const netExposure = rows.reduce((sum, row) => sum + row.net_usd, 0)
  // **这张表列全部标的，不折灰尘。** 饼上小块并进了「其他」，那几个的去处就只剩
  // 这里；折起来等于两处都看不到。它同时也是饼的图例，行数与环高相当，
  // 左右两栏因此高度相称——上一版右边七行、左边一个环加一张清单，右下角空一大片。
  const major = rows
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
          figure={signedMoney(netExposure)}
          note={`净敞口 · ${rows.length} 个标的`}
          span="lg:col-span-12"
          title="敞口分布"
        >
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">当前没有敞口。</p>
          ) : (
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <Donut
                focus={focus}
                hub={(
                  <div className="flex flex-col items-center gap-0.5">
                    {shownSlice === null ? (
                      <span className="tnum text-lg text-ink">{money(longTotal)}</span>
                    ) : (
                      <>
                        <Ticker asset={shownSlice.key} />
                        <span className="tnum text-lg text-ink">{money(shownSlice.value)}</span>
                        <span className="tnum text-xs text-ink-3">
                          {percent(longTotal > 0 ? shownSlice.value / longTotal : null, 1)}
                        </span>
                      </>
                    )}
                  </div>
                )}
                onFocus={setHover}
                onPin={(asset) => setPinned((now) => (asset === null || now === asset ? null : asset))}
                slices={slices}
                total={longTotal}
              />
            </div>
            <ul className="min-w-0 flex-1 divide-y divide-rule">
              {major.map((row) => {
                const inPie = slices.some((slice) => slice.key === row.asset)
                const on = focus === row.asset
                return (
                  <li key={row.asset}>
                    {/* 整行是个按钮：鼠标指上、键盘 Tab 到，饼那边同步亮起来。
                        空头（MSTR 这种）在饼里没有块，指它只高亮这一行，
                        不去把饼整个压暗——那会让人以为"这个标的不见了"。 */}
                    <button
                      aria-pressed={pinned === row.asset}
                      className={cn(
                        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3',
                        // 不加过渡：饼那边是瞬时切换，这一行再淡入淡出就对不上拍
                        'rounded-[3px] px-1.5 py-2.5 text-left outline-none',
                        'hover:bg-sheet-2/70 focus-visible:outline focus-visible:outline-1',
                        'focus-visible:outline-offset-1 focus-visible:outline-accent',
                        on && 'bg-sheet-2',
                        focus !== null && !on && 'opacity-45',
                      )}
                      onBlur={() => setHover(null)}
                      onClick={() => {
                        if (inPie) setPinned((now) => (now === row.asset ? null : row.asset))
                      }}
                      onFocus={() => setHover(row.asset)}
                      onMouseEnter={() => setHover(row.asset)}
                      onMouseLeave={() => setHover(null)}
                      type="button"
                    >
                      <span className="flex items-center gap-2">
                        {/* 色块把这一行和环上的块对起来——这张表就是饼的图例 */}
                        {swatchOf(row.asset)
                          ? <Swatch color={swatchOf(row.asset) as string} />
                          : <span className="size-2.5 shrink-0" />}
                        <Ticker asset={row.asset} size="sm" />
                        <span className="w-[52px] shrink-0 truncate text-sm text-ink">{row.asset}</span>
                      </span>
                      {/* 零点在中间：空头往左、多头往右，多空对锁的标的一眼看得出
                          两边都短。饼图做不到这件事——它画不了负数。 */}
                      <span className="relative block h-[5px] rounded-full bg-rule">
                        <span
                          className={cn('absolute top-0 block h-full rounded-full',
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
                    </button>
                  </li>
                )
              })}
            </ul>
            </div>
          )}
        </Module>

        <Module
          figure={hit.equity_usd === null ? '—' : money(hit.equity_usd)}
          note={size === 'now' ? `跌 ${drop}% 之后的净值` : `仓位 ${size}× · 跌 ${drop}% 之后的净值`}
          span="lg:col-span-7"
          title="压力测试"
          tone={hit.liquidated.length > 0 ? 'loss' : undefined}
        >
          <div className="mb-5 flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <span className="w-[40px] shrink-0 text-xs text-ink-2">仓位</span>
              <SegmentedControl
                items={[
                  { value: 'now' as SizeKey, label: '现在' },
                  ...(['1', '1.5', '2'] as SizeKey[]).map((k) => ({ value: k, label: `${k}×` })),
                ]}
                label="仓位规模"
                onValueChange={setSize}
                size="sm"
                value={size}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-[40px] shrink-0 text-xs text-ink-2">下跌</span>
              <SegmentedControl
                items={(Object.keys(DROPS) as (keyof typeof DROPS)[])
                  .map((k) => ({ value: k, label: `${k}%` }))}
                label="下跌幅度"
                onValueChange={setDrop}
                size="sm"
                value={drop}
              />
            </div>
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
                  // 条不做宽度过渡：数字是立刻变的，条却滑上大半秒，两者对不上
                  className={cn('block h-full rounded-full',
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

          {/* 「以 N× 杠杆还能开多少」原本是独立一块，可它读的就是上面那个
              「可用余额」——同一个压力情形的两种问法，分开摆等于把一次判断
              拆成两块，右边还多出一个杠杆开关。并进来之后这一节自成一段。 */}
          <div className="mt-6 border-t border-rule pt-5">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="text-sm text-ink-2">
                可开仓位 <span className="text-xs text-ink-3">以这个杠杆还能开多少</span>
              </span>
              <span className="tnum text-sm text-ink">{multiplier}×</span>
            </div>
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
          </div>

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

        <Stack span="lg:col-span-5">
          <Module
            figure={edge === null ? '—' : percent(edge, 1)}
            note="一起跌到这里开始强平"
            span=""
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


