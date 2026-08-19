import { useMemo, useState, type CSSProperties } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { SectionHead } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { DUST_THRESHOLD_USD, amount, money, percent, price } from '../../lib/format'
import type { Balance } from '../../api/types'

const ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_112px]'

function Ticker({ asset }: { asset: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-surface-2 font-mono text-[10px] font-medium tracking-tight text-fg-2">
      {asset.slice(0, 3)}
    </span>
  )
}

function HoldingRow({ item, share }: { item: Balance; share: number }) {
  const unpriceable = item.value_usd === null
  return (
    <li className={cn(ROW, 'py-3 transition-colors duration-200 hover:bg-surface-2/45')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Ticker asset={item.asset} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] text-fg">{item.asset}</div>
          {item.used > 0 && (
            <div className="tnum text-[11px] text-fg-3">{amount(item.used)} 挂单占用</div>
          )}
        </div>
      </div>

      <div className="tnum hidden text-[13px] text-fg-2 sm:block">{amount(item.total)}</div>
      <div className="tnum hidden text-[13px] text-fg-3 sm:block">{price(item.price_usd)}</div>

      <div className="text-right sm:text-left">
        {unpriceable ? (
          <span className="text-[12px] text-fg-3">无报价</span>
        ) : (
          <span className="tnum text-[13.5px] text-fg">{money(item.value_usd)}</span>
        )}
        <div className="tnum text-[11px] text-fg-3 sm:hidden">{amount(item.total)}</div>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full bg-fg-3 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }}
          />
        </span>
        <span className="tnum w-[34px] shrink-0 text-right text-[11px] text-fg-3">
          {share >= 0.001 ? percent(share, 0) : '<1%'}
        </span>
      </div>
    </li>
  )
}

export function HoldingsList({ balances, veiled }: { balances: Balance[]; veiled: boolean }) {
  const [dustOpen, setDustOpen] = useState(false)

  const { major, dust, dustValue, total } = useMemo(() => {
    const spot = balances.filter((b) => b.venue === 'spot')
    const sorted = [...spot].sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1))
    const sum = sorted.reduce((acc, item) => acc + (item.value_usd ?? 0), 0)
    return {
      major: sorted.filter((b) => (b.value_usd ?? 0) >= DUST_THRESHOLD_USD),
      dust: sorted.filter((b) => (b.value_usd ?? 0) < DUST_THRESHOLD_USD),
      dustValue: sorted
        .filter((b) => (b.value_usd ?? 0) < DUST_THRESHOLD_USD)
        .reduce((acc, item) => acc + (item.value_usd ?? 0), 0),
      total: sum,
    }
  }, [balances])

  const share = (item: Balance) => (total > 0 ? (item.value_usd ?? 0) / total : 0)

  return (
    <section className={cn('rise', veiled && 'veiled')} style={{ '--i': 3 } as CSSProperties}>
      <SectionHead
        aside={<span className="tnum text-[12px] text-fg-3">{money(total)}</span>}
        label="现货 · Spot"
        title="持仓明细"
      />

      <div className={cn(ROW, 'border-b border-line pb-2 text-[11px] text-fg-3')}>
        <span>资产</span>
        <span className="hidden sm:block">数量</span>
        <span className="hidden sm:block">价格</span>
        <span className="text-right sm:text-left">价值</span>
        <span className="hidden text-right sm:block">占比</span>
      </div>

      {major.length === 0 && dust.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-fg-3">现货账户里没有余额。</p>
      ) : (
        <ul className="divide-y divide-line">
          {major.map((item) => (
            <HoldingRow item={item} key={`${item.venue}-${item.asset}`} share={share(item)} />
          ))}
        </ul>
      )}

      {dust.length > 0 && (
        <div className="border-t border-line">
          <button
            aria-expanded={dustOpen}
            className="flex w-full items-center gap-2.5 py-3 text-left transition-colors duration-200 hover:text-fg"
            onClick={() => setDustOpen((open) => !open)}
            type="button"
          >
            <CaretDown
              className={cn('shrink-0 text-fg-3 transition-transform duration-300', dustOpen && 'rotate-180')}
              size={13}
            />
            <span className="text-[12.5px] text-fg-2">
              {dust.length} 项灰尘余额
            </span>
            <span className="tnum ml-auto text-[12.5px] text-fg-3">{money(dustValue)}</span>
          </button>

          <div className="collapsible" data-open={dustOpen}>
            <div>
              <ul className="divide-y divide-line border-t border-line">
                {dust.map((item) => (
                  <HoldingRow item={item} key={`${item.venue}-${item.asset}`} share={share(item)} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
