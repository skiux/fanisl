import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { Figure, Module, ViewGrid } from '../../components/layout'
import { ExposureList, ExposureWheel, useExposure } from './ExposureDistribution'
import { SegmentedControl } from '../../components/controls'
import {
  money, percent, signedMoney, signedPercent,
} from '../../lib/format'
import { cash, exposures } from '../../lib/holdings'
import {
  breakingDrop, openingCapacity, positionSize, positionTarget, resize, shock,
} from '../../lib/stress'
import type { PortfolioSnapshot } from '../../api/types'

const DROPS = { '10': 0.1, '20': 0.2, '30': 0.3, '50': 0.5 } as const
const OPEN_LEVERAGES = [1, 2, 3, 5] as const
/**
 * 压力测试用的仓位规模。`now` = 现在这套仓位；其余是"**如果把仓位开到 N 倍
 * 真实杠杆**"——按现价重新建仓（见 `stress.resize`），再往下跌。
 *
 * 有这一档是因为"现在安全"回答不了"我打算加到 2 倍，那时候还安不安全"，
 * 而后者才是要在加仓**之前**知道的。
 */
const SIZES = { now: null, '1': 1, '1.5': 1.5, '2': 2 } as const
type SizeKey = keyof typeof SIZES
type Panel = 'holdings' | 'stress'

/**
 * 风险控制。合约页逐仓显示距强平，但它回答不了"所有仓位一起跌多少会出局"——
 * 逐个仓位各看各的距离，而账户是共用一份保证金的，多个仓位一起亏才是真实情形，
 * 分开看会系统性地低估。
 *
 * 四块，从"现在怎样"走到"还能扛多少"：
 *
 *   临界跌幅   一起跌多少开始强平；补上现金之后又是多少
 *   敞口分布   按标的合并现货与永续之后，钱压在哪几个东西上
 *   压力测试   选一个跌幅，看净值 / 仓位价值 / 可用余额 / 谁会被强平
 *   现金缓冲   还能往合约里补多少
 *
 * 敞口分布由 ExposureDistribution 展示：多头构成与带方向的净敞口分别保留。
 */
export function RiskControlView({ snapshot }: {
  snapshot: PortfolioSnapshot
}) {
  const [drop, setDrop] = useState<keyof typeof DROPS>('30')
  const [panel, setPanel] = useState<Panel>('holdings')
  const equity = snapshot.totals?.equity_usd ?? 0
  const rows = useMemo(() => exposures(snapshot, equity), [snapshot, equity])
  const exposure = useExposure(rows)
  const cashRows = useMemo(() => cash(snapshot), [snapshot])
  // 现货钱包里的稳定币才是**随时能划进合约**的那部分：理财要赎回、
  // 合约里的那份本来就已经是保证金了
  const sumWhere = (test: (where: string) => boolean) => cashRows
    .filter((row) => test(row.where))
    .reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
  const spare = sumWhere((where) => where === '现货')
  const parked = sumWhere((where) => where.startsWith('理财'))
  const asMargin = sumWhere((where) => where === '合约保证金')
  // 管理员录入的交易所以外的现金：算在净值与现金里，要用得先转进交易所
  const external = sumWhere((where) => where === '交易所外')
  const cashTotal = cashRows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)

  const currentPosition = useMemo(() => positionSize(snapshot), [snapshot])
  const canProjectPosition = currentPosition !== null && currentPosition > 0
    && equity > 0 && (snapshot.futures?.total_margin_balance ?? 0) > 0
  const [size, setSize] = useState<SizeKey>('now')
  const activeSize: SizeKey = canProjectPosition ? size : 'now'
  useEffect(() => {
    if (!canProjectPosition && size !== 'now') setSize('now')
  }, [canProjectPosition, size])
  // 先把仓位调到设定的规模，再施加下跌。两步分开，`resize` 与 `shock` 各自可测
  const staged = useMemo(() => {
    const target = SIZES[activeSize]
    return target === null ? snapshot : resize(snapshot, target)
  }, [snapshot, activeSize])
  const hit = useMemo(() => shock(staged, DROPS[drop]), [staged, drop])
  const positionBeforeDrop = useMemo(() => positionSize(staged), [staged])
  const edge = useMemo(() => breakingDrop(snapshot), [snapshot])
  const edgeWithCash = useMemo(() => breakingDrop(snapshot, spare), [snapshot, spare])
  const sizeOptions = useMemo(() => ([
    {
      key: 'now' as SizeKey,
      label: '现在',
      notional: currentPosition,
      difference: null,
    },
    ...(['1', '1.5', '2'] as const).map((key) => {
      const target = positionTarget(snapshot, SIZES[key])
      return {
        key,
        label: `${key}×`,
        notional: target.notional_usd,
        difference: target.remaining_usd,
      }
    }),
  ]), [snapshot, currentPosition])

  if (snapshot.futures === null && rows.length === 0) {
    return (
      <div>
        <ViewGrid>
          <Module span="lg:col-span-7" title="风险控制">
            <p className="text-sm text-ink-3">当前没有可评估仓位。</p>
          </Module>
        </ViewGrid>
      </div>
    )
  }

  const tabs: { key: Panel; label: string }[] = [
    { key: 'holdings', label: '全部持仓' }, { key: 'stress', label: '压力测试' },
  ]

  return (
    <div className="space-y-7">
      {/* 上半左右各一半，与下半「强平临界跌幅 / 现金缓冲」同一条中线（2026-10-03 用户画的）：
          左边持仓轮，右边「全部持仓 / 压力测试」两个标签，同合约页的「账户 / 委托」。
          右栏的高度跟着左边的轮走，内容多了在栏里滚，不把这一行撑高 */}
      <div
        className="grid min-w-0 gap-x-12 gap-y-8 lg:grid-cols-2"
        data-risk-main
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); exposure.select(null) }
        }}
      >
        <Module span="" title="持仓价值分布">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">当前没有持仓。</p>
          ) : (
            <ExposureWheel model={exposure} />
          )}
        </Module>

        <section aria-label="全部持仓与压力测试" className="flex min-w-0 flex-col">
          <div className="flex items-end justify-between gap-3 border-b border-rule">
            <div aria-label="风险内容" className="flex gap-6" role="tablist">
              {tabs.map(({ key, label }) => (
                <button
                  aria-controls={`risk-panel-${key}`}
                  aria-selected={panel === key}
                  className={cn('relative pb-2.5 text-sm leading-6 transition-colors duration-200',
                    panel === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
                  id={`risk-tab-${key}`}
                  key={key}
                  onClick={() => setPanel(key)}
                  role="tab"
                  type="button"
                >
                  {label}
                  {panel === key && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-ink" />}
                </button>
              ))}
            </div>
            <span className={cn('tnum pb-2.5 text-xs',
              panel === 'stress' && hit.liquidated.length > 0 ? 'text-loss' : 'text-ink-3')}>
              {panel === 'holdings' ? `${rows.length} 个`
                : hit.liquidated.length > 0 ? `${hit.liquidated.length} 个触及强平` : `跌 ${drop}%`}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="flex flex-col pt-3 lg:absolute lg:inset-0">
              {/* 列表不卸载，只藏起来：切到压力测试再切回来，滚动位置和选中都还在 */}
              <div
                aria-labelledby="risk-tab-holdings"
                className={cn('flex min-h-0 flex-1 flex-col', panel !== 'holdings' && 'hidden')}
                id="risk-panel-holdings"
                role="tabpanel"
              >
                {rows.length === 0
                  ? <p className="py-10 text-center text-sm text-ink-3">当前没有持仓。</p>
                  : <ExposureList className="flex-1" heading={false} model={exposure} />}
              </div>
              {panel === 'stress' && (
                <div
                  aria-label="压力测试数据"
                  aria-labelledby="risk-tab-stress"
                  className="scroll-y min-h-0 min-w-0 flex-1 lg:overflow-y-auto lg:pr-1"
                  data-risk-stress-scroll
                  id="risk-panel-stress"
                  role="tabpanel"
                  tabIndex={0}
                >
            <div className="mb-5">
              <div className="mb-2.5 flex items-baseline justify-between gap-4">
                <span className="text-xs text-ink-2">合约总价值</span>
              </div>
              <div
                aria-label="仓位规模"
                className="grid grid-cols-2 gap-2"
                onKeyDown={(event) => {
                  const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End']
                  if (!keys.includes(event.key)) return
                  const options = [...event.currentTarget
                    .querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
                  const index = options.indexOf(event.target as HTMLButtonElement)
                  if (index < 0) return
                  event.preventDefault()
                  const nextIndex = event.key === 'Home' ? 0
                    : event.key === 'End' ? options.length - 1
                      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
                        + options.length) % options.length
                  const next = options[nextIndex]
                  next.focus()
                  setSize(next.dataset.size as SizeKey)
                }}
                role="radiogroup"
              >
                {sizeOptions.map((option) => {
                  const on = activeSize === option.key
                  const difference = option.difference
                  return (
                    <button
                      aria-checked={on}
                      className="stress-size-option min-w-0 rounded-xl border border-rule px-3 py-3 text-left"
                      data-selected={on}
                      data-size={option.key}
                      disabled={option.key !== 'now' && !canProjectPosition}
                      key={option.key}
                      onClick={() => setSize(option.key)}
                      role="radio"
                      tabIndex={on ? 0 : -1}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-2 text-xs text-ink-2">
                        {option.label}
                        <span aria-hidden="true" className="stress-size-dot size-1.5 rounded-full bg-ink" />
                      </span>
                      <span className="tnum mt-2 block text-sm font-medium tracking-tight">
                        {option.notional === null ? '—' : money(option.notional)}
                      </span>
                      <span className="mt-2 block text-[10px] text-ink-3">
                        {difference === null ? '当前杠杆 ' : difference >= 0 ? '还可开 ' : '已超出 '}
                      </span>
                      <span className="tnum mt-0.5 block text-[11px] text-ink-2">
                        {difference === null
                          ? (equity > 0 && currentPosition !== null ? `${(currentPosition / equity).toFixed(2)}× 净值` : '当前基准')
                          : money(Math.abs(difference))}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-3">
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

            <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Figure
                label="净值"
                tone="loss"
                value={hit.equity_usd === null ? '—' : money(hit.equity_usd)}
                note={equity > 0 && hit.equity_usd !== null
                  ? signedPercent(hit.equity_usd / equity - 1, 1) : undefined}
              />
              <Figure
                label="合约未实现"
                tone={hit.unrealized_usd === null || hit.unrealized_usd === 0
                  ? undefined : hit.unrealized_usd > 0 ? 'gain' : 'loss'}
                value={hit.unrealized_usd === null ? '—' : signedMoney(hit.unrealized_usd)}
              />
              <Figure label="仓位价值" value={hit.position_usd === null ? '—' : money(hit.position_usd)} />
              <Figure
                label="可用余额"
                tone={(hit.available_usd ?? 0) < 0 ? 'loss' : undefined}
                value={hit.available_usd === null ? '—' : money(Math.max(0, hit.available_usd))}
              />
            </dl>

            <div className="mt-4 border-t border-rule pt-4" data-open-capacity>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink-2">剩余开仓能力</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {OPEN_LEVERAGES.map((leverage) => {
                  const before = openingCapacity(
                    staged.totals?.equity_usd ?? null, positionBeforeDrop, leverage,
                  )
                  const after = openingCapacity(hit.equity_usd, hit.position_usd, leverage)
                  return (
                    <div
                      className="open-capacity-card min-w-0 rounded-lg border border-rule px-2.5 py-2.5"
                      data-open-leverage={leverage}
                      key={leverage}
                    >
                      <div className="tnum mb-2 text-xs font-medium text-ink">{leverage}×</div>
                      <dl className="space-y-1.5">
                        <div>
                          <dt className="text-[10px] text-ink-3">下跌前可开</dt>
                          <dd className="tnum mt-0.5 break-all text-[11px] text-ink-2">
                            {before === null ? '—' : money(before)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-ink-3">跌 {drop}% 后可开</dt>
                          <dd className="tnum mt-0.5 break-all text-[11px] text-ink">
                            {after === null ? '—' : money(after)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )
                })}
              </div>
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
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="grid min-w-0 gap-x-12 gap-y-7 lg:grid-cols-2" data-risk-support>
        <Module
          figure={edge === null ? '＞99.5%' : percent(edge, 1)}
          span=""
          title="强平临界跌幅"
          tone={edge === null ? 'muted' : edge < 0.15 ? 'loss' : undefined}
        >
          {/* 一行四格（窄屏两行）：下半压矮一点，上半多露出几行持仓 */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Figure label="未补现金" value={edge === null ? '＞99.5%' : percent(edge, 1)} />
            <Figure
              label="补入现货现金后"
              note={spare > 0 ? money(spare) : undefined}
              value={edgeWithCash === null ? '＞99.5%' : percent(edgeWithCash, 1)}
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
        </Module>

        {/* 逐行的现金明细在「持仓」页，这里只回答"还能补多少保证金"——
            按**能不能马上划过去**分三档，那才是这一页要的切法。 */}
        <Module
          figure={money(cashTotal)}
          span=""
          title="现金缓冲"
        >
          {cashRows.length === 0 ? (
            <p className="text-sm text-ink-3">账户里没有稳定币。</p>
          ) : (
            <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-3', external > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
              <Figure label="现货 · 可直接划转" value={money(spare)} />
              <Figure label="理财 · 需赎回" value={money(parked)} />
              <Figure label="已作保证金" value={money(asMargin)} />
              {external > 0 && <Figure label="交易所外 · 需转入" value={money(external)} />}
              <Figure
                label="占净值"
                value={percent(equity > 0 ? cashTotal / equity : null, 1)}
              />
            </dl>
          )}
        </Module>
      </div>
    </div>
  )
}
