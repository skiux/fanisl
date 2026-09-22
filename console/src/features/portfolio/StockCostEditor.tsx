import { useMemo, useState, type FormEvent } from 'react'
import type { StockCostInput } from '../../api/client'
import type { StockPosition } from '../../api/types'
import { amount, money } from '../../lib/format'

type CostRecord = Pick<StockPosition,
  'cost_price_usd' | 'commission_usd' | 'cost_position_qty'> & {
  cost_status: 'manual' | 'missing' | 'stale' | 'unavailable'
}

export function PositionCostEditor({ row, asset, quantity, unit, kind, onCancel, onSave }: {
  row: CostRecord
  asset: string
  quantity: number
  unit: string
  kind: 'stock' | 'spot'
  onCancel: () => void
  onSave: (input: StockCostInput) => Promise<void>
}) {
  const [costPrice, setCostPrice] = useState(
    row.cost_price_usd === null ? '' : String(row.cost_price_usd))
  const [commission, setCommission] = useState(
    row.commission_usd === null ? '' : String(row.commission_usd))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => ({
    price: Number(costPrice),
    fee: Number(commission),
  }), [costPrice, commission])
  const valid = costPrice.trim() !== '' && commission.trim() !== ''
    && Number.isFinite(parsed.price) && parsed.price > 0
    && Number.isFinite(parsed.fee) && parsed.fee >= 0
    && quantity > 0
  const total = valid ? parsed.price * quantity + parsed.fee : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid) {
      setError('请填写大于 0 的单位成本价；手续费可以为 0。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        cost_price_usd: parsed.price,
        commission_usd: parsed.fee,
        position_qty: quantity,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="mt-4 rounded-[10px] border border-rule bg-sheet-2/55 p-3.5 sm:p-4"
      data-stock-cost-editor={kind === 'stock' ? asset : undefined}
      data-spot-cost-editor={kind === 'spot' ? asset : undefined}
      onSubmit={submit}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-ink">录入成本价与手续费</div>
          <p className="mt-0.5 text-micro text-ink-3">当前 {amount(quantity)} {unit} · 多次买入请填写平均成本价</p>
        </div>
        {row.cost_status === 'stale' && row.cost_position_qty !== null && (
          <span className="tnum text-micro text-ink-3">原记录 {amount(row.cost_position_qty)} {unit}</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs text-ink-2">
          <span>单位成本价（USD / {unit}）</span>
          <input
            autoFocus
            className="tnum h-10 min-w-0 rounded-[7px] border border-rule-strong bg-sheet px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-ink focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            inputMode="decimal"
            onChange={(event) => setCostPrice(event.target.value)}
            placeholder="例如 24.00"
            type="text"
            value={costPrice}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-ink-2">
          <span>手续费（USD）</span>
          <input
            className="tnum h-10 min-w-0 rounded-[7px] border border-rule-strong bg-sheet px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-ink focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            inputMode="decimal"
            onChange={(event) => setCommission(event.target.value)}
            placeholder="没有则填 0"
            type="text"
            value={commission}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-3 border-t border-rule pt-3 sm:flex-row sm:items-end sm:justify-between">
        <dl className="grid grid-cols-2 gap-x-6 text-xs">
          <div>
            <dt className="text-ink-3">总成本 · 单价 × 数量 + 手续费</dt>
            <dd className="tnum mt-0.5 text-ink">{money(total)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">平均成本</dt>
            <dd className="tnum mt-0.5 text-ink">
              {money(total === null ? null : total / quantity)}
            </dd>
          </div>
        </dl>
        <div className="flex items-center justify-end gap-3">
          <button
            className="rounded-[6px] px-2.5 py-1.5 text-xs text-ink-3 transition-[color,transform] duration-150 hover:text-ink active:translate-y-px disabled:opacity-45"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="min-w-[72px] rounded-[6px] bg-ink px-3 py-1.5 text-xs text-sheet transition-[opacity,transform] duration-150 hover:opacity-85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            disabled={saving}
            type="submit"
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 border-t border-loss/25 pt-2.5 text-xs leading-relaxed text-loss" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

export function StockCostEditor({ row, onCancel, onSave }: {
  row: StockPosition
  onCancel: () => void
  onSave: (input: StockCostInput) => Promise<void>
}) {
  return <PositionCostEditor
    asset={row.symbol} kind="stock" onCancel={onCancel} onSave={onSave}
    quantity={row.total_qty} row={row} unit="股"
  />
}
