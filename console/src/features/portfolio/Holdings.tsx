import { useMemo, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { amount, DUST_THRESHOLD_USD, money, percent, price } from '../../lib/format'
import type { EarnPosition, SpotAsset } from '../../api/types'

const ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_112px]'

function Ticker({ asset }: { asset: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-sheet-2 font-mono text-[10px] font-medium tracking-tight text-ink-2">
      {asset.slice(0, 3)}
    </span>
  )
}

/** 锁定原因不止一种，合并成"占用"会丢掉"为什么动不了" */
function lockNote(item: SpotAsset) {
  const parts: string[] = []
  if (item.locked > 0) parts.push(`${amount(item.locked)} 挂单`)
  if (item.freeze > 0) parts.push(`${amount(item.freeze)} 冻结`)
  if (item.withdrawing > 0) parts.push(`${amount(item.withdrawing)} 提现中`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function SpotRow({ item, share }: { item: SpotAsset; share: number }) {
  const note = lockNote(item)
  return (
    <li className={cn(ROW, 'py-3 transition-colors duration-200 hover:bg-sheet-2/45')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Ticker asset={item.asset} />
        <div className="min-w-0">
          <div className="truncate text-sm text-ink">{item.asset}</div>
          {note && <div className="tnum truncate text-micro text-ink-3" title={note}>{note}</div>}
        </div>
      </div>
      <div className="tnum hidden text-sm text-ink-2 sm:block">{amount(item.total)}</div>
      <div className="tnum hidden text-sm text-ink-3 sm:block">{price(item.price_usd)}</div>
      <div className="text-right sm:text-left">
        {item.value_usd === null
          ? <span className="text-xs text-ink-3">无报价</span>
          : <span className="tnum text-sm text-ink">{money(item.value_usd)}</span>}
        <div className="tnum text-micro text-ink-3 sm:hidden">{amount(item.total)}</div>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-rule">
          <span
            className="block h-full rounded-full bg-ink-3 transition-[width] duration-500"
            style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }}
          />
        </span>
        <span className="tnum w-[34px] shrink-0 text-right text-micro text-ink-3">
          {share >= 0.005 ? percent(share, 0) : '<1%'}
        </span>
      </div>
    </li>
  )
}

export function SpotTable({ spot }: { spot: SpotAsset[] }) {
  const [dustOpen, setDustOpen] = useState(false)
  const { major, dust, dustValue, total } = useMemo(() => {
    const sorted = [...spot].sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1))
    const isDusty = (item: SpotAsset) => (item.value_usd ?? 0) < DUST_THRESHOLD_USD
    return {
      major: sorted.filter((item) => !isDusty(item)),
      dust: sorted.filter(isDusty),
      dustValue: sorted.filter(isDusty).reduce((sum, item) => sum + (item.value_usd ?? 0), 0),
      total: sorted.reduce((sum, item) => sum + (item.value_usd ?? 0), 0),
    }
  }, [spot])
  const share = (item: SpotAsset) => (total > 0 ? (item.value_usd ?? 0) / total : 0)

  if (spot.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">现货账户里没有余额。</p>
  }

  return (
    <>
      <div className={cn(ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>资产</span>
        <span className="hidden sm:block">数量</span>
        <span className="hidden sm:block">价格</span>
        <span className="text-right sm:text-left">价值</span>
        <span className="hidden text-right sm:block">占比</span>
      </div>
      <ul className="divide-y divide-rule">
        {major.map((item) => <SpotRow item={item} key={item.asset} share={share(item)} />)}
      </ul>
      {dust.length > 0 && (
        <div className="border-t border-rule">
          <button
            aria-expanded={dustOpen}
            className="flex w-full items-center gap-2.5 py-3 text-left transition-colors duration-200 hover:text-ink"
            onClick={() => setDustOpen((open) => !open)}
            type="button"
          >
            <CaretDown aria-hidden="true" className={cn('shrink-0 text-ink-3 transition-transform duration-300', dustOpen && 'rotate-180')} size={13} />
            <span className="text-xs text-ink-2">{dust.length} 项灰尘余额</span>
            <span className="tnum ml-auto text-xs text-ink-3">{money(dustValue)}</span>
          </button>
          <div className="collapsible" data-open={dustOpen}>
            <div>
              <ul className="divide-y divide-rule border-t border-rule">
                {dust.map((item) => <SpotRow item={item} key={item.asset} share={share(item)} />)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function EarnTable({ earn }: { earn: EarnPosition[] }) {
  if (earn.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">没有理财持仓。</p>
  }
  return (
    <ul className="grid gap-x-10 sm:grid-cols-2 xl:grid-cols-3">
      {earn.map((item) => (
        <li className="flex items-center gap-3 border-b border-rule py-3.5" key={item.product_id}>
          <Ticker asset={item.asset} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink">{item.asset}</span>
              <span className="rounded-[4px] bg-sheet-2 px-1.5 py-px text-micro text-ink-2">
                {item.kind === 'flexible' ? '活期' : '定期'}
              </span>
            </div>
            <div className="tnum mt-0.5 text-micro text-ink-3">
              {amount(item.amount)}
              {item.redeem_date && ` · ${item.redeem_date} 到期`}
              {!item.can_redeem && item.kind === 'locked' && ' · 锁定中'}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tnum text-sm text-ink">{money(item.value_usd)}</div>
            <div className="tnum text-micro text-gain">
              {item.apr === null ? '—' : `${percent(item.apr, 2)} 年化`}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
