import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { ExposureDistribution } from './ExposureDistribution'
import { SegmentedControl } from '../../components/controls'
import {
  money, percent, signedMoney, signedPercent,
} from '../../lib/format'
import { cash, exposures } from '../../lib/holdings'
import { breakingDrop, resize, shock } from '../../lib/stress'
import { marginRatioRisk, riskBar, riskText } from '../../lib/risk'
import type { PortfolioSnapshot } from '../../api/types'

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
 * 敞口分布由 ExposureDistribution 展示：多头构成与带方向的净敞口分别保留。
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

  const [size, setSize] = useState<SizeKey>('now')
  // 先把仓位调到设定的规模，再施加下跌。两步分开，`resize` 与 `shock` 各自可测
  const staged = useMemo(() => {
    const target = SIZES[size]
    return target === null ? snapshot : resize(snapshot, target)
  }, [snapshot, size])
  const hit = useMemo(() => shock(staged, DROPS[drop]), [staged, drop])
  const edge = useMemo(() => breakingDrop(snapshot), [snapshot])
  const edgeWithCash = useMemo(() => breakingDrop(snapshot, spare), [snapshot, spare])

  const netExposure = rows.reduce((sum, row) => sum + row.net_usd, 0)
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
            <ExposureDistribution rows={rows} />
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


