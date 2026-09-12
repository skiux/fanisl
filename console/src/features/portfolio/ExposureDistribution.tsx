import { useRef, useState } from 'react'
import { AllocationWheel, Swatch } from '../../components/AllocationWheel'
import { Ticker } from '../../components/Ticker'
import { cn } from '../../lib/cn'
import { allocationPercent } from '../../lib/allocation'
import { money, signedMoney } from '../../lib/format'
import type { Exposure } from '../../lib/holdings'

/** 颜色绑定代码而非排名；金额刷新导致重新排序时，资产仍保持自己的颜色。 */
function assetColor(asset: string) {
  let hash = 5381
  for (const letter of asset) hash = ((hash << 5) + hash) ^ letter.charCodeAt(0)
  return `oklch(var(--allocation-tone) 0.075 ${(hash >>> 0) % 360})`
}

const smallMoney = (value: number) => value > 0 && value < 0.005 ? '<$0.01' : money(value)

/** 持仓轮展示多头构成；列表同时保留净敞口及其占净值比例，分母分别标明。 */
export function ExposureDistribution({ rows }: { rows: Exposure[] }) {
  const [selection, setSelection] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const items = rows.map((row) => ({
    ...row,
    // gross = 多头 + 空头绝对值，net = 多头 − 空头绝对值；对锁也能还原多头。
    long: Math.max(0, (row.gross_usd + row.net_usd) / 2),
    color: assetColor(row.asset),
  })).sort((a, b) => b.long - a.long || Math.abs(b.net_usd) - Math.abs(a.net_usd) || a.asset.localeCompare(b.asset))
  const slices = items.filter((row) => row.long > 0)
    .map((row) => ({ key: row.asset, value: row.long, color: row.color }))
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const selected = items.find((row) => row.asset === selection) ?? null
  const peak = Math.max(...items.map((row) => Math.abs(row.net_usd)), 1)
  const select = (key: string | null) => {
    // 改选、取消选择都停止旧滚动，即便新行已在视野内也不继续滚向旧资产。
    const list = listRef.current
    list?.scrollTo({ top: list.scrollTop, behavior: 'instant' })
    setSelection(key)
  }
  const toggle = (key: string) => select(selection === key ? null : key)
  const selectFromChart = (key: string | null) => {
    select(key)
    const list = listRef.current
    if (!list || key === null) return
    const row = [...list.querySelectorAll<HTMLButtonElement>('[data-asset]')]
      .find((node) => node.dataset.asset === key)
    if (!row) return
    const box = list.getBoundingClientRect()
    const item = row.getBoundingClientRect()
    if (item.top >= box.top && item.bottom <= box.bottom) return
    // 只滚动明细容器；scrollIntoView 会同时拖动外层页面和左侧持仓轮。
    list.scrollTo({
      top: list.scrollTop + item.top - box.top - (list.clientHeight - item.height) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  return (
    <div
      className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)] lg:items-stretch lg:gap-10"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); select(null) }
      }}
    >
      <div className="min-w-0">
        <div className="mb-3 flex min-h-11 items-end justify-between gap-3 text-xs">
          <div>
            <div className="text-ink-2">多头构成 <span className="ml-1.5 tnum text-ink-3">{slices.length}</span></div>
            <div className="tnum mt-1 text-sm font-medium" data-allocation-total>{money(total)}</div>
          </div>
          <button
            aria-label="清除资产选择"
            className={cn('allocation-reset min-h-9 rounded-full border border-rule px-3 text-ink-2', !selected && 'pointer-events-none opacity-0')}
            disabled={!selected}
            onClick={() => select(null)} type="button"
          >查看全部</button>
        </div>
        <AllocationWheel
          items={slices}
          onSelect={selectFromChart}
          selected={selected?.asset ?? null}
        />
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {selected
            ? `${selected.asset}，多头 ${smallMoney(selected.long)}，${total > 0 ? allocationPercent(selected.long / total) : '0%'}`
            : `${total > 0 ? '多头合计' : '暂无多头敞口'}，${money(total)}，${slices.length} 个标的`}
        </div>
        <div className="mt-4 grid min-h-16 grid-cols-2 gap-4 border-t border-rule pt-4">
          <div>
            <div className="text-xs text-ink-3">{selected ? `${selected.asset} 净敞口` : '净敞口合计'}</div>
            <div className="tnum mt-1 text-sm">{signedMoney(selected?.net_usd ?? rows.reduce((sum, row) => sum + row.net_usd, 0))}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-3">{selected ? '占净值' : '标的数量'}</div>
            <div className="tnum mt-1 text-sm">{selected ? allocationPercent(selected.share) : rows.length}</div>
          </div>
        </div>
      </div>

      <div className="allocation-list relative min-h-0 min-w-0">
        <div className="allocation-list-body flex min-h-0 flex-col">
          <div className="mb-1 flex items-center justify-between gap-4 px-3 py-2 text-xs text-ink-3">
            <span>全部标的 <span className="tnum ml-1">{items.length}</span></span><span>多头金额 / 占多头</span>
          </div>
          <div aria-label="标的列表滚动区域" className="allocation-scroll scroll-y rounded-lg" ref={listRef} role="region" tabIndex={0}>
            <ul aria-label="全部敞口明细" className="divide-y divide-rule">
              {items.map((row) => {
                const on = selected?.asset === row.asset
                return (
                  <li key={row.asset}>
                    <button
                      aria-pressed={on}
                      className="allocation-row grid min-h-[72px] w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-lg px-3 py-3 text-left"
                      data-asset={row.asset}
                      data-selected={on}
                      onClick={() => toggle(row.asset)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {row.long > 0 ? <Swatch color={row.color} /> : <span className="size-2 shrink-0 rounded-full border border-ink-3" />}
                        <Ticker asset={row.asset} size="sm" />
                        <span className="break-all text-sm font-medium">{row.asset}</span>
                      </span>
                      <span className="allocation-values flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
                        <span className="tnum text-sm">{smallMoney(row.long)}</span>
                        <span className="tnum min-w-[58px] text-right text-xs text-ink-2">{total > 0 ? allocationPercent(row.long / total) : '0%'}</span>
                      </span>
                      <span className="allocation-meta col-span-2 flex items-center gap-3">
                        <span aria-hidden="true" className="relative h-[3px] min-w-3 flex-1 rounded-full bg-rule">
                          <span className="absolute -top-0.5 bottom-[-2px] left-1/2 w-px bg-rule-strong" />
                          <span
                            className={cn('absolute top-0 h-full rounded-full bg-ink-3', row.net_usd >= 0 ? 'left-1/2' : 'right-1/2')}
                            style={{ width: `${Math.abs(row.net_usd) / peak * 50}%` }}
                          />
                        </span>
                        <span className="text-xs text-ink-3">净 <span className="tnum text-ink-2">{signedMoney(row.net_usd)}</span></span>
                        <span className="text-xs text-ink-3">净值 <span className="tnum">{allocationPercent(row.share)}</span></span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
