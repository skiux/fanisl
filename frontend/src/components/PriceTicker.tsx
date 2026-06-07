import { useEffect, useState } from 'react'
import { fetchPrices } from '../api'
import type { Price } from '../types'

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT']

export default function PriceTicker() {
  const [prices, setPrices] = useState<Price[]>([])
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const p = await fetchPrices(SYMBOLS)
        if (alive) {
          setPrices(p)
          setErr(false)
        }
      } catch {
        if (alive) setErr(true)
      }
    }
    tick()
    const id = setInterval(tick, 5000) // 每 5 秒轮询
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex items-center gap-6 px-5 py-2.5 bg-white border-b border-gray-200 overflow-x-auto">
      <span className="text-xs font-semibold text-gray-400 shrink-0">实时价格</span>
      {prices.map((p) => {
        const chg = p.change_pct_24h
        const up = (chg ?? 0) >= 0
        return (
          <div key={p.symbol} className="flex items-baseline gap-2 shrink-0">
            <span className="text-sm font-medium text-gray-500">
              {p.symbol.replace('/USDT', '')}
            </span>
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {p.last != null
                ? p.last.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : '—'}
            </span>
            {chg != null && (
              <span
                className={`text-xs font-medium tabular-nums ${
                  up ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {up ? '+' : ''}
                {chg.toFixed(2)}%
              </span>
            )}
          </div>
        )
      })}
      {err && prices.length === 0 && (
        <span className="text-xs text-red-500 shrink-0">价格获取失败（后端没起？）</span>
      )}
    </div>
  )
}
