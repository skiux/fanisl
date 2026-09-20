import { useMemo, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { Ticker } from '../../components/Ticker'
import { amount, DUST_THRESHOLD_USD, money, percent, price } from '../../lib/format'
import type { EarnPosition, EquityHolding, TokenizedStockAsset } from '../../api/types'
import type { CashRow, SpotHoldingRow } from '../../lib/holdings'

const ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_112px]'

/** 合并后仍保留资产所在钱包与锁定原因，否则总数无法核对。 */
function rowNote(item: SpotHoldingRow) {
  const parts: string[] = []
  if (item.locations.length > 1 || item.locations[0] !== '现货') {
    parts.push(item.locations.join(' · '))
  }
  if (item.locked > 0) parts.push(`${amount(item.locked)} 挂单`)
  if (item.freeze > 0) parts.push(`${amount(item.freeze)} 冻结`)
  if (item.withdrawing > 0) parts.push(`${amount(item.withdrawing)} 提现中`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function SpotRow({ item, share }: { item: SpotHoldingRow; share: number }) {
  const note = rowNote(item)
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

export function SpotTable({ spot }: { spot: SpotHoldingRow[] }) {
  const [dustOpen, setDustOpen] = useState(false)
  const { major, dust, dustValue, total } = useMemo(() => {
    const sorted = [...spot].sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1))
    const isDusty = (item: SpotHoldingRow) => (item.value_usd ?? 0) < DUST_THRESHOLD_USD
    return {
      major: sorted.filter((item) => !isDusty(item)),
      dust: sorted.filter(isDusty),
      dustValue: sorted.filter(isDusty).reduce((sum, item) => sum + (item.value_usd ?? 0), 0),
      total: sorted.reduce((sum, item) => sum + (item.value_usd ?? 0), 0),
    }
  }, [spot])
  const share = (item: SpotHoldingRow) => (total > 0 ? (item.value_usd ?? 0) / total : 0)

  if (spot.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">当前没有现货类资产。</p>
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

const STOCK_ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]'

/**
 * 直接买入的正股。价格由钱包估值反推（市值 / 股数），不是另取的行情：
 * 两者对得上，市值就与净值里那块资金钱包是同一个数。没有估值的写「—」，不写 $0。
 */
export function EquityHoldingsTable({ rows }: { rows: EquityHolding[] }) {
  return (
    <>
      <div className={cn(STOCK_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>股票</span>
        <span className="hidden sm:block">股数</span>
        <span className="hidden sm:block">估值价</span>
        <span className="text-right">市值</span>
      </div>
      <ul className="divide-y divide-rule">
        {rows.map((row) => (
          <li className={cn(STOCK_ROW, 'py-3')} key={`${row.wallet}:${row.asset_code}`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Ticker asset={row.symbol} />
              <span className="min-w-0">
                <span className="block text-sm text-ink">{row.symbol}</span>
                {row.name && <span className="block truncate text-micro text-ink-3">{row.name}</span>}
              </span>
            </span>
            <span className="tnum hidden text-sm text-ink-2 sm:block">{amount(row.qty)}</span>
            <span className="tnum hidden text-sm text-ink-2 sm:block">
              {row.price_usd === null ? '—' : price(row.price_usd)}
            </span>
            <span className="tnum text-right text-sm text-ink">
              {row.value_usd === null ? '—' : money(row.value_usd)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

export function TokenizedStocksTable({ rows }: { rows: TokenizedStockAsset[] }) {
  return (
    <>
      <div className={cn(STOCK_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>股票</span>
        <span className="hidden sm:block">钱包资产</span>
        <span className="hidden sm:block">对应股数</span>
        <span className="text-right">价值</span>
      </div>
      <ul className="divide-y divide-rule">
        {rows.map((row) => (
          <li className={cn(STOCK_ROW, 'py-3')} key={`${row.wallet}:${row.asset_code}`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Ticker asset={row.symbol} />
              <span className="min-w-0">
                <span className="block text-sm text-ink">{row.symbol}</span>
                <span className="block truncate text-micro text-ink-3">{row.name}</span>
              </span>
            </span>
            <span className="tnum hidden text-sm text-ink-2 sm:block">{row.asset_code}</span>
            <span className="tnum hidden text-sm text-ink-2 sm:block">
              {row.underlying_qty === null ? '—' : amount(row.underlying_qty)}
            </span>
            <span className="tnum text-right text-sm text-ink">
              {row.value_usd === null ? '—' : money(row.value_usd)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

const CASH_ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]'

/**
 * 现金放在哪儿。**同一个币会同时出现在几行**（现货一行、理财一行、合约保证金
 * 一行），所以这张表的主键是"币 + 在哪"，不是币。
 *
 * 「在哪」那一列不是装饰：合约钱包里的那几行是**保证金本身**，动它就等于动强平价；
 * 理财里的那几行在生息但赎回要时间；现货里的才是随手能用的。
 */
export function CashTable({ rows }: { rows: CashRow[] }) {
  return (
    <>
      <div className={cn(CASH_ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>资产</span>
        <span className="hidden sm:block">在哪</span>
        <span className="hidden sm:block">年化</span>
        <span className="text-right">价值</span>
      </div>
      <ul className="divide-y divide-rule">
        {rows.map((row) => (
          <li className={cn(CASH_ROW, 'py-3')} key={`${row.where}:${row.asset}`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Ticker asset={row.asset} size="sm" />
              <span className="truncate text-sm text-ink">{row.asset}</span>
              {/* 窄屏没有「在哪」那一列，位置跟在代码后面 */}
              <span className="shrink-0 text-micro text-ink-3 sm:hidden">{row.where}</span>
            </span>
            <span className="hidden text-sm text-ink-2 sm:block">{row.where}</span>
            <span className={cn('tnum hidden text-sm sm:block',
              row.apr === null ? 'text-ink-3' : 'text-gain')}>
              {row.apr === null ? '—' : percent(row.apr, 2)}
            </span>
            <span className="tnum text-right text-sm text-ink">
              {row.value_usd === null ? '—' : money(row.value_usd)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
