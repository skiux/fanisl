import { useMemo, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { Ticker } from '../../components/Ticker'
import { amount, DUST_THRESHOLD_USD, money, percent, price, signedMoney, signedPercent } from '../../lib/format'
import type { SpotCostInput } from '../../api/client'
import type { EarnPosition, EquityHolding, TokenizedStockAsset } from '../../api/types'
import type { CashRow, SpotHoldingRow } from '../../lib/holdings'
import { PositionCostEditor } from './StockCostEditor'

const ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_112px]'

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

/**
 * 成本价那一格同时是管理员的入口。原先「录入成本 / 修正成本」是每行下面单起一行的
 * 链接，十二个币种就是十二条悬着的下划线，加上另一行成本价与盈亏，整张表糊成一片。
 * 现在它们各归各列，行里不再多出第三行。
 */
function CostCell({ item, canEdit, onEdit }: {
  item: SpotHoldingRow
  canEdit: boolean
  onEdit: () => void
}) {
  const known = item.cost_status === 'manual'
  if (!canEdit) {
    return known
      ? <span className="tnum text-sm text-ink-2"><MobileLabel />{price(item.cost_price_usd)}</span>
      // 窄屏没有列头，一个孤零零的破折号读不出是什么，那里索性不占位
      : <span className="hidden text-sm text-ink-3 sm:block">—</span>
  }
  return (
    <button
      // 已录入的成本先当数字看，下划线只在悬停时出现；缺成本那一格才常驻下划线，
      // 它是这一列里唯一需要被找到的东西
      className={cn('tnum text-sm decoration-rule-strong underline-offset-4 transition-colors duration-150 hover:underline hover:text-ink',
        known ? 'text-ink-2' : 'text-ink-3 underline')}
      onClick={onEdit}
      title={known ? '修正成本'
        : item.cost_status === 'stale' ? '持仓数量已变化，需要重新录入成本' : '录入成本'}
      type="button"
    >
      {known ? <><MobileLabel />{price(item.cost_price_usd)}</>
        : item.cost_status === 'stale' ? '待更新'
        : <>录入<span className="sm:hidden">成本</span></>}
    </button>
  )
}

/** 窄屏把成本收到资产下面那一行，那里没有列头，得自己带一个 */
function MobileLabel() {
  return <span className="text-micro text-ink-3 sm:hidden">成本 </span>
}

function SpotRow({ item, share, canEditCost, onSaveCost }: {
  item: SpotHoldingRow
  share: number
  canEditCost: boolean
  onSaveCost?: (asset: string, input: SpotCostInput) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const note = rowNote(item)
  // 余额来源不可用时录入没有意义：存下的数量对不上当前持仓，存进去就是一条错记录
  const canEdit = canEditCost && Boolean(onSaveCost) && item.cost_status !== 'unavailable'
  return (
    <li className="py-3.5 transition-colors duration-200 hover:bg-sheet-2/45" data-spot-position={item.asset}>
      <div className={ROW}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Ticker asset={item.asset} />
          <div className="min-w-0">
            <div className="truncate text-sm text-ink">{item.asset}</div>
            {note && <div className="tnum truncate text-micro text-ink-3" title={note}>{note}</div>}
          </div>
        </div>
        <div className="tnum hidden text-sm text-ink-2 sm:block">{amount(item.total)}</div>
        <div className="tnum hidden text-sm text-ink-3 sm:block">{price(item.price_usd)}</div>
        {/* 窄屏只剩资产与价值两列，成本落到资产下面那一行，而不是跟着列一起消失 */}
        <div className="col-start-1 row-start-2 min-w-0 sm:col-auto sm:row-auto">
          <CostCell canEdit={canEdit} item={item} onEdit={() => setEditing(true)} />
        </div>
        <div className="col-start-2 row-start-1 text-right sm:col-auto sm:row-auto sm:text-left">
          {item.value_usd === null
            ? <span className="text-xs text-ink-3">无报价</span>
            : <span className="tnum text-sm text-ink">{money(item.value_usd)}</span>}
          {/* 盈亏挂在市值下面：它就是市值减录入成本，不是另立的一笔数。
              现货只是拿着，不写"未实现"——那是合约仓位才有的说法。 */}
          {item.pnl_usd !== null && (
            <div className="tnum text-micro">
              <span className={item.pnl_usd >= 0 ? 'text-gain' : 'text-loss'}>
                {signedMoney(item.pnl_usd)}
              </span>
              <span className="text-ink-3"> {signedPercent(item.pnl_pct)}</span>
            </div>
          )}
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
      </div>
      {canEdit && onSaveCost && editing && (
        <div className="sm:pl-[34px]">
          <PositionCostEditor
            asset={item.asset} kind="spot" quantity={item.total} row={item} unit={item.asset}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              await onSaveCost(item.asset, input)
              setEditing(false)
            }}
          />
        </div>
      )}
    </li>
  )
}

export function SpotTable({ spot, canEditCost = false, onSaveCost }: {
  spot: SpotHoldingRow[]
  canEditCost?: boolean
  onSaveCost?: (asset: string, input: SpotCostInput) => Promise<void>
}) {
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
        <span className="hidden sm:block">现价</span>
        <span className="hidden sm:block">成本价</span>
        <span className="text-right sm:text-left">价值</span>
        <span className="hidden text-right sm:block">占比</span>
      </div>
      <ul className="divide-y divide-rule">
        {major.map((item) => <SpotRow canEditCost={canEditCost} item={item} key={item.asset} onSaveCost={onSaveCost} share={share(item)} />)}
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
                {dust.map((item) => <SpotRow canEditCost={canEditCost} item={item} key={item.asset} onSaveCost={onSaveCost} share={share(item)} />)}
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
