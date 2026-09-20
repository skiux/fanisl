import { useMemo, useState } from 'react'
import { SortBy, type SortState } from '../../components/controls'
import { Figure, Module, SplitBar } from '../../components/layout'
import { Delta } from '../../components/Primitives'
import { Ticker } from '../../components/Ticker'
import { amount, money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import type { StockPosition, StocksAccount, TokenizedStockAsset } from '../../api/types'
import {
  STOCK_SORT_KEYS, sortStockPositions, stockTotals, type StockSort,
} from './stock-position-model'

const TRADABILITY: Record<string, string> = {
  BUY_SELL: '可买卖',
  BUY: '仅可买',
  SELL: '仅可卖',
  NONE: '暂停交易',
  // 兼容灰度阶段曾返回过的旧枚举。
  BUY_ONLY: '仅可买',
  SELL_ONLY: '仅可卖',
  NOT_TRADABLE: '暂停交易',
}

function occupied(row: StockPosition) {
  return row.locked_qty + row.freeze_qty + row.withdrawing_qty
}

function StockPositionRow({ row }: { row: StockPosition }) {
  const used = occupied(row)
  const costAvailable = row.cost_status === 'reconciled' || row.cost_status === 'estimated'
  const quote = row.bid_usd !== null || row.ask_usd !== null
    ? `${price(row.bid_usd)} / ${price(row.ask_usd)}` : '—'
  const features = [
    row.tradability ? (TRADABILITY[row.tradability] ?? row.tradability) : null,
    row.fractionable_extended ? '延长时段可买碎股'
      : row.fractionable ? '常规时段可买碎股' : null,
    row.extended_session ? '支持扩展时段' : null,
    row.overnight_supported ? '支持隔夜' : null,
  ].filter(Boolean)

  return (
    <li
      className="flex gap-3 border-b border-rule py-4 first:pt-0 last:border-b-0"
      data-stock-position={row.symbol}
    >
      <Ticker asset={row.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm text-ink">{row.symbol}</span>
              {row.direct_qty > 0 && (
                <span className="rounded-[4px] bg-sheet-2 px-1.5 py-px text-[9.5px] text-ink-2">正股</span>
              )}
              {row.tokenized_qty > 0 && (
                <span className="rounded-[4px] border border-rule px-1.5 py-px text-[9.5px] text-ink-3">代币化</span>
              )}
            </div>
            <div className="tnum mt-1 text-xs text-ink-3">
              <span className="text-ink-2">{amount(row.total_qty)} 股</span>
              {' · '}可用 {amount(row.available_qty)}
              {used > 0 && <> · 占用 {amount(used)}</>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {costAvailable ? (
              <>
                <Delta className="text-sm" value={row.unrealized_pnl_usd}>
                  {signedMoney(row.unrealized_pnl_usd)}
                </Delta>
                <div className="tnum text-xs text-ink-3">
                  {signedPercent(row.unrealized_pnl_pct)}
                  {row.cost_status === 'estimated' && ' · 未含手续费'}
                </div>
              </>
            ) : row.cost_status === 'unavailable' ? (
              <>
                <div className="text-xs text-ink-2">成本数据暂缺</div>
                <div className="mt-0.5 text-micro text-ink-3">等待历史取数恢复</div>
              </>
            ) : (
              <>
                <div className="text-xs text-ink-2">成本待核对</div>
                <div className="mt-0.5 text-micro text-ink-3">不合计盈亏</div>
              </>
            )}
          </div>
        </div>

        <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-ink-3">
              {row.cost_status === 'estimated' ? '估算成本' : '成本'}
            </dt>
            <dd className="truncate text-ink-2">{price(row.avg_cost_usd)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">买 / 卖</dt>
            <dd className="truncate text-ink-2" title={quote}>{quote}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">钱包估值</dt>
            <dd className="truncate text-ink-2">{money(row.wallet_value_usd)}</dd>
          </div>
        </dl>

        {(features.length > 0 || row.spread_bps !== null) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-3">
            {row.spread_bps !== null && <span className="tnum">价差 {row.spread_bps.toFixed(1)} bp</span>}
            {features.map((feature) => (
              <span className="before:mr-2 before:text-rule-strong before:content-['·']" key={feature}>
                {feature}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function UnresolvedTokenizedRow({ row }: { row: TokenizedStockAsset }) {
  return (
    <li
      className="flex gap-3 border-b border-rule py-4 first:pt-0 last:border-b-0"
      data-stock-unresolved={row.asset_code}
    >
      <Ticker asset={row.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">{row.symbol}</span>
              <span className="rounded-[4px] border border-rule px-1.5 py-px text-[9.5px] text-ink-3">
                {row.asset_code}
              </span>
            </div>
            <div className="tnum mt-1 text-xs text-ink-3">{amount(row.qty)} 枚代币</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm text-ink-2">{money(row.value_usd)}</div>
            <div className="mt-0.5 text-micro text-ink-3">钱包估值</div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Binance 当前未确认换算比例，暂不折算股票股数、成本或盈亏。
        </p>
      </div>
    </li>
  )
}

export function StockPositionsList({ positions, unresolved = [] }: {
  positions: StockPosition[]
  unresolved?: TokenizedStockAsset[]
}) {
  const [sort, setSort] = useState<SortState<StockSort>>({ key: 'value', direction: 'desc' })
  const rows = useMemo(() => sortStockPositions(positions, sort), [positions, sort])
  if (positions.length === 0 && unresolved.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">当前没有股票持仓。</p>
  }
  return (
    <div data-stock-positions>
      {positions.length > 1 && (
        <div className="mb-1 border-b border-rule pb-2.5">
          <SortBy keys={STOCK_SORT_KEYS} label="排序" onChange={setSort} value={sort} />
        </div>
      )}
      <ul>
        {rows.map((row) => <StockPositionRow key={row.symbol} row={row} />)}
        {unresolved.map((row) => <UnresolvedTokenizedRow key={row.asset_code} row={row} />)}
      </ul>
    </div>
  )
}

export function StockSummary({ stocks, equityUsd }: {
  stocks: StocksAccount
  equityUsd: number | null
}) {
  const totals = stockTotals(stocks)
  const unresolved = stocks.tokenized_assets.filter((row) => !row.multiplier_valid).length
  const available = stocks.cost_coverage.reconciled + stocks.cost_coverage.estimated
  const incomplete = stocks.cost_coverage.total - available
  const costTotal = stocks.cost_coverage.total + unresolved
  const pending = incomplete + unresolved
  const allCovered = costTotal > 0 && pending === 0
  const exact = allCovered && stocks.cost_coverage.estimated === 0
  const allValued = totals.total !== null
  return (
    <div className="flex flex-col gap-9 lg:col-span-4" data-stock-summary>
      <Module
        figure={money(totals.total)}
        note={allValued ? '钱包估值' : `已估值 ${totals.valuedCount} / ${totals.holdingCount}`}
        span=""
        title="股票市值"
      >
        {totals.direct !== null && totals.tokenized !== null && (
          <SplitBar
            left={totals.direct}
            leftLabel="正股"
            right={totals.tokenized}
            rightLabel="代币化"
          />
        )}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
          <Figure label="正股" value={money(totals.direct)} />
          <Figure label="代币化" value={money(totals.tokenized)} />
          <Figure
            label="占净值"
            value={percent(equityUsd && totals.total !== null ? totals.total / equityUsd : null, 1)}
          />
          <Figure
            label="实时报价"
            value={stocks.positions.length > 0
              ? `${totals.quoteCount} / ${stocks.positions.length}` : '—'}
          />
        </dl>
      </Module>

      <Module
        figure={`${available} / ${costTotal}`}
        note={allCovered
          ? stocks.cost_coverage.estimated > 0
            ? `${stocks.cost_coverage.estimated} 项为估算` : '全部一致'
          : `${pending} 项待核对`}
        span=""
        title="成本核对"
        tone={exact ? 'gain' : 'muted'}
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
          <Figure
            label="可用成本"
            note={`${available} / ${costTotal} 项`}
            value={money(totals.knownCost)}
          />
          <Figure
            label="已报价盈亏"
            note={`${totals.pnlCount} / ${costTotal} 项`}
            tone={totals.knownPnl === null ? undefined : totals.knownPnl >= 0 ? 'gain' : 'loss'}
            value={signedMoney(totals.knownPnl)}
          />
        </dl>
        {stocks.cost_coverage.estimated > 0 && (
          <p className="mt-4 border-t border-rule pt-3 text-xs leading-relaxed text-ink-3">
            估算项的成交数量已与钱包核对，成本与未实现盈亏暂未包含 Binance 未返回的手续费。
          </p>
        )}
        {pending > 0 && (
          <p className="mt-4 border-t border-rule pt-3 text-xs leading-relaxed text-ink-3">
            只合计股数与钱包一致的仓位；其余仓位不显示成本和盈亏。
          </p>
        )}
      </Module>
    </div>
  )
}
