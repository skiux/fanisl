import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { cn } from '../../lib/cn'
import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { SegmentedControl } from '../../components/controls'
import { Ticker, tickerHue } from '../../components/Ticker'
import { ICONS } from '../../components/icons'
import {
  money, moneyCompact, percent, signedMoney, signedPercent,
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
  const slices = [...shown]
  // 折进「其他」的那几个块上写不下，**去处是右边那张表**——它列全部标的，
  // 一个都不折。图不该靠 hover 才说得全，也不该靠两处各抄一遍。
  const rest = longs.filter((row) => !shown.includes(row))
    .reduce((sum, row) => sum + row.value, 0)
  if (rest > longTotal * 0.001) slices.push({ asset: '其他', value: rest })

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
            <Donut
              focus={focus}
              onHover={setHover}
              onPin={(asset) => setPinned((now) => (asset === null || now === asset ? null : asset))}
              slices={slices}
              total={longTotal}
            />
            <ul className="min-w-0 flex-1 divide-y divide-rule">
              {major.map((row) => {
                const inPie = slices.some((slice) => slice.asset === row.asset)
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
                        'rounded-[3px] px-1.5 py-2.5 text-left outline-none transition-colors duration-200',
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


type Slice = { asset: string; value: number }

/* --- 几何。一处定义，标签、引导线、命中层都读它 ------------------------- */
// 环画得尽量大：外侧标签只有小块才用得上，为它们留的边距不该常年空着。
// 85px 够写一行「其他 / 0.4% · $128」，再宽就是白占地方。
const BOX_W = 540
const BOX_H = 420
const CX = 270
const CY = 208
const R_OUT = 185
const R_IN = 104
/** 环带中线：块里的标签落在这条线上 */
const R_MID = (R_OUT + R_IN) / 2
/** 占比到这个数才写得进块里；再小就走外侧标签 + 引导线 */
const INSIDE_MIN = 0.08
/** 外侧标签之间的最小垂直间距，靠得太近就互相推开 */
const LABEL_GAP = 28
/** 引导线第一段：沿半径往外 */
const LEAD_1 = 14
/** 引导线第二段：横向一小截，标签接在末端 */
const LEAD_2 = 20

type Placed = {
  asset: string; value: number; frac: number; rank: number
  /** 这一块在整圈里的起止位置，0 = 12 点、顺时针到 1。命中测试用 */
  t0: number; t1: number
  /** 弧中点的方向（弧度，SVG 坐标系） */
  rad: number
  inside: boolean
  /** 外侧标签的落点 */
  lx: number; ly: number; side: 1 | -1
}

/**
 * 排版：算出每块的角度、决定标签在里还是在外，再把外侧标签上下推开。
 *
 * **推开这一步不能省。** 小块的弧中点常常挨得很近（0.2% 与 0.1% 差不到一度），
 * 标签直接叠在一起，等于没写。同一侧的按 y 排序，不足 `LABEL_GAP` 就往外挤。
 */
function layout(slices: Slice[], total: number): Placed[] {
  let cum = 0
  const placed: Placed[] = slices.map((slice, rank) => {
    const frac = total > 0 ? slice.value / total : 0
    const t0 = cum
    // recharts 从 12 点起顺时针走：中点角 = 90 − 360×(累计 + 一半)
    const midDeg = 90 - 360 * (cum + frac / 2)
    cum += frac
    const rad = -(midDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const side: 1 | -1 = cos >= 0 ? 1 : -1
    return {
      ...slice, frac, rank, rad, t0, t1: cum,
      inside: frac >= INSIDE_MIN,
      // 标签跟着弧走，**不钉到画布边**。钉到边（ECharts 的 alignTo: 'edge'）在
      // 块多的时候整齐，可这里常常只有一两个小块——一条横穿半张图的引导线牵到
      // 角落里一个小标签，读着像掉出去的碎片。通行做法是"短径向 + 短横线"，
      // 标签就落在弧边外一点。
      lx: CX + cos * (R_OUT + LEAD_1) + side * LEAD_2,
      ly: Math.min(BOX_H - 24, Math.max(24, CY + sin * (R_OUT + LEAD_1))),
      side,
    }
  })

  for (const side of [1, -1] as const) {
    const col = placed.filter((it) => !it.inside && it.side === side)
      .sort((a, b) => a.ly - b.ly)
    for (let i = 1; i < col.length; i += 1) {
      const gap = col[i].ly - col[i - 1].ly
      if (gap < LABEL_GAP) col[i].ly = col[i - 1].ly + LABEL_GAP
    }
    // 挤出画布就整列往回顶
    const over = (col.at(-1)?.ly ?? 0) - (BOX_H - 26)
    if (over > 0) for (const it of col) it.ly -= over
  }
  return placed
}

/** 标的图标，SVG 版。没有图标的画成带色的字母圆片，和 `Ticker` 同一套色相 */
function Mark({ asset, x, y, r }: { asset: string; x: number; y: number; r: number }) {
  const file = ICONS[asset]
  const id = `mk-${asset.replace(/[^A-Za-z0-9]/g, '')}`
  if (!file) {
    return (
      <g>
        <circle cx={x} cy={y} fill={`oklch(0.90 0.05 ${tickerHue(asset)})`} r={r} />
        <text
          fill={`oklch(0.42 0.10 ${tickerHue(asset)})`}
          fontSize={r * 0.82}
          textAnchor="middle"
          x={x}
          y={y + r * 0.3}
        >
          {asset.slice(0, 3)}
        </text>
      </g>
    )
  }
  return (
    <g>
      <clipPath id={id}>
        <circle cx={x} cy={y} r={r} />
      </clipPath>
      <image
        clipPath={`url(#${id})`}
        height={r * 2}
        href={`${import.meta.env.BASE_URL}icons/${file}`}
        width={r * 2}
        x={x - r}
        y={y - r}
      />
    </g>
  )
}

/**
 * 多头敞口的构成。**只画正数**：空头是负的，饼画不了负数——那正是横条还留着的
 * 理由，两者回答的不是同一个问题（饼：钱压在哪几个东西上；横条：价格动一下
 * 账户净暴露多少，空头会抵掉现货）。
 *
 * 重做过三轮，前两轮的错都记在这里免得再犯：
 *
 * - **图不该靠 hover 才说得全。** 上一版只给四块写了标签，小块折进「其他」就
 *   再没有下文——静止状态下有信息是缺的。现在**每一块都有标签**：大块写在环带里
 *   （图标 + 代码 + 占比 + 金额），小块走外侧标签配引导线，同一侧还会互相推开；
 *   折进「其他」的那几个在图底下逐个列出来。
 * - **不用 `activeShape`。** 它换的是元素，元素一换 CSS 过渡就从头开始。
 * - **不用逐块的 DOM 事件（`onMouseEnter` / `onMouseLeave`），改成几何命中测试。**
 *   这是"鼠标转圈就闪烁"的根治办法。用逐块事件时，从 A 划到 B 的顺序是
 *   **先 A 的 leave、再 B 的 enter**，中间那一帧 focus 是空的——整圈亮回来又立刻
 *   暗回去；而块之间还有 `paddingAngle` 的缝，扫过缝时确实谁都没命中，
 *   于是转一圈闪一路。同一个毛病 Highcharts 报过（#9501），
 *   而 Chart.js / ECharts 这类画布库天生没有：它们根本没有逐块的 DOM 元素，
 *   只在整块画布的 `mousemove` 上做几何判断。
 *   这里照搬那个做法——一层盖住整张图的透明层，按**极角**算指针落在哪一块。
 *   A→B 是一次状态切换，中间不经过空值；缝也不再是洞。
 * - **recharts 会给画布挂 `tabindex`，点一下浏览器就画一个蓝框。** 它并不能用键盘
 *   操作，那个框是纯粹的误导；键盘走右边那张表（每行是真按钮）。
 *   蓝框在 index.css 里按 `.recharts-wrapper` 去掉。
 */
function Donut({ slices, total, focus, onHover, onPin }: {
  slices: Slice[]
  total: number
  focus: string | null
  onHover: (asset: string | null) => void
  /** `null` = 点在空白处，取消钉住 */
  onPin: (asset: string | null) => void
}) {
  const placed = useMemo(() => layout(slices, total), [slices, total])
  const shown = placed.find((slice) => slice.asset === focus) ?? null
  const [over, setOver] = useState(false)

  /**
   * 指针落在哪一块。**几何判断，不靠 DOM 事件**——理由见上面的组件注释。
   *
   * 环从 12 点起顺时针铺，所以先把屏幕极角换成"从 12 点起转过了整圈的几分之几"
   * （屏幕坐标 y 朝下，`atan2` 在 12 点处是 −π/2，加回来正好从 0 起算），
   * 再拿它比每一块的起止。半径上给一点富余，指针在边缘抖一下不至于掉出去。
   */
  const hitTest = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return null
    const k = BOX_W / box.width
    const dx = (event.clientX - box.left) * k - CX
    const dy = (event.clientY - box.top) * k - CY
    const r = Math.hypot(dx, dy)
    if (r < R_IN - 4 || r > R_OUT + 8) return null
    const t = ((Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI) + 1) % 1
    return placed.find((slice) => t >= slice.t0 && t < slice.t1)?.asset ?? null
  }

  return (
    <div className="min-w-0 shrink-0 lg:w-[540px]">
      <div className="pie-in relative">
        <ResponsiveContainer aspect={BOX_W / BOX_H} width="100%">
          <PieChart margin={{ bottom: 0, left: 0, right: 0, top: 0 }}>
            <Pie
              cx={CX}
              cy={CY}
              data={slices}
              dataKey="value"
              endAngle={-270}
              innerRadius={R_IN}
              // 入场动画走 rAF，页面不可见时不发，扇区会停在 0 度——**整张图都不画**。
              // 入场交给 CSS（`.pie-in`），见 index.css。
              isAnimationActive={false}
              label={(props: SliceLabel) => renderLabel(props, placed, focus)}
              labelLine={false}
              nameKey="asset"
              outerRadius={R_OUT}
              paddingAngle={0.8}
              startAngle={90}
              stroke="none"
            >
              {placed.map((slice) => (
                <Cell
                  // 压暗只能走 class：`Cell` 上的 `style` 与 `opacity` 都会被
                  // recharts 的 `filterProps` 过掉，一个字节到不了 path。
                  className={cn('pie-slice',
                    focus !== null && focus !== slice.asset && 'pie-dim')}
                  fill={sliceInk(slice.rank, slice.asset)}
                  key={slice.asset}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/*
          命中层：盖住整张图，按极角算指针落在哪一块。**所有指针交互都走这里**，
          扇区自己 `pointer-events: none`（见 index.css）。
          点空白处 = 取消钉住，比"再点一次同一块"更顺手。
        */}
        <div
          className="absolute inset-0"
          onClick={(event) => onPin(hitTest(event))}
          onPointerLeave={() => { setOver(false); onHover(null) }}
          onPointerMove={(event) => {
            const asset = hitTest(event)
            setOver(asset !== null)
            onHover(asset)
          }}
          style={{ cursor: over ? 'pointer' : 'default' }}
        />

        {/* 圈心。SVG 里排文字要自己算基线，用一层绝对定位的 div 省事，
            也顺带拿到和别处一样的字体度量。 */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {/* **不靠 `key` 重挂载做淡入。** 转圈划过时那会每换一块重放一次淡入，
              本身就是一种闪。内容直接换，动的只有环上的明暗。 */}
          <div
            className="flex flex-col items-center gap-0.5"
            // 圈心的方框对齐环的中心；`aspect` 让容器高度跟着宽度走，
            // 中心点因此永远在 CY/BOX_H 处
            style={{ transform: `translateY(${((CY - BOX_H / 2) / BOX_H * 100).toFixed(2)}%)` }}
          >
            {shown === null ? (
              <span className="tnum text-lg text-ink">{money(total)}</span>
            ) : (
              <>
                <Ticker asset={shown.asset} />
                <span className="tnum text-lg text-ink">{money(shown.value)}</span>
                <span className="tnum text-xs text-ink-3">{percent(shown.frac, 1)}</span>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

/** recharts 把这些都标成可选，渲染时一定都有；缺任何一个就不画标签 */
type SliceLabel = { index?: number }

/**
 * 一块的标签。大块写进环带里（图标 / 代码 / 占比 / 金额），小块写在外面、
 * 配一条两段的引导线。位置全部来自 `layout()`，不用 recharts 给的角度——
 * 外侧标签需要相互推开，那要一次性看到所有块才算得出来。
 *
 * 写不下时返回空的 `<g />` 而不是 `null`：recharts 会把返回值当元素接着处理。
 */
function renderLabel(props: SliceLabel, placed: Placed[], focus: string | null) {
  const slice = props.index === undefined ? undefined : placed[props.index]
  if (!slice || slice.frac <= 0) return <g />
  const on = focus === null || focus === slice.asset
  const cos = Math.cos(slice.rad)
  const sin = Math.sin(slice.rad)

  if (slice.inside) {
    const x = CX + cos * R_MID
    const y = CY + sin * R_MID
    return (
      <g className="pie-label" style={{ opacity: on ? 1 : 0.22 }}>
        <Mark asset={slice.asset} r={12} x={x} y={y - 26} />
        <text fill="var(--ink-2)" fontSize={11} textAnchor="middle" x={x} y={y - 4}>
          {slice.asset}
        </text>
        <text className="tnum" fill="var(--ink)" fontSize={19} fontWeight={500} textAnchor="middle" x={x} y={y + 16}>
          {(slice.frac * 100).toFixed(1)}%
        </text>
        <text className="tnum" fill="var(--ink-2)" fontSize={10.5} textAnchor="middle" x={x} y={y + 31}>
          {moneyCompact(slice.value)}
        </text>
      </g>
    )
  }

  // 外侧：弧边 → 沿半径出去一小段 → 横向一小截，标签接在末端
  const ax = CX + cos * (R_OUT + 2)
  const ay = CY + sin * (R_OUT + 2)
  const bx = CX + cos * (R_OUT + LEAD_1)
  const by = slice.ly
  const tx = slice.lx
  return (
    <g className="pie-label" style={{ opacity: on ? 1 : 0.22 }}>
      <polyline
        fill="none"
        points={`${ax},${ay} ${bx},${by} ${tx},${by}`}
        stroke="var(--rule-strong)"
        strokeWidth={1}
      />
      <Mark asset={slice.asset} r={7} x={tx + slice.side * 9} y={by} />
      <text
        fill="var(--ink-2)"
        fontSize={10.5}
        textAnchor={slice.side === 1 ? 'start' : 'end'}
        x={tx + slice.side * 20}
        y={by - 2}
      >
        {slice.asset}
      </text>
      <text
        className="tnum"
        fill="var(--ink-3)"
        fontSize={10}
        textAnchor={slice.side === 1 ? 'start' : 'end'}
        x={tx + slice.side * 20}
        y={by + 11}
      >
        {(slice.frac * 100).toFixed(1)}% · {moneyCompact(slice.value)}
      </text>
    </g>
  )
}
