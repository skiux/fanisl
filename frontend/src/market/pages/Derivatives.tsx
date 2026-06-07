import type { WatchlistEntry } from '../../types'
import { fmtUsd } from '../format'
import { useWatchlist } from '../useMarketData'
import { DataTable, Freshness, PageShell } from '../ui'

const funding = (v: number) => (v * 100).toFixed(4) + '%'
const usd = (v: number) => fmtUsd(v)
const r2 = (v: number) => v.toFixed(2)
const pct = (v: number) => v.toFixed(3) + '%'
const n1 = (v: number) => v.toFixed(1)

const COLS: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: 'price', label: '价格', fmt: usd },
  { key: 'funding_rate', label: '资金费率', fmt: funding },
  { key: 'open_interest_usd', label: '未平仓量', fmt: usd },
  { key: 'lsr', label: '多空比', fmt: r2 },
  { key: 'top_trader_lsr', label: '大户多空', fmt: r2 },
  { key: 'basis_perp', label: '永续基差', fmt: pct },
  { key: 'basis_quarterly', label: '季度基差', fmt: pct },
  { key: 'dvol', label: 'DVOL', fmt: n1 },
  { key: 'atm_iv', label: 'ATM IV', fmt: n1 },
  { key: 'put_call_ratio', label: 'PCR', fmt: r2 },
  { key: 'max_pain', label: '最大痛点', fmt: usd },
  { key: 'liq_long_24h', label: '多爆24h', fmt: usd },
  { key: 'liq_short_24h', label: '空爆24h', fmt: usd },
]

function buildRows(symbols: WatchlistEntry[]) {
  return symbols.map((e) => ({
    name: e.symbol.replace('/USDT', ''),
    cells: Object.fromEntries(
      COLS.map((c) => {
        const v = e.metrics[c.key]?.value
        return [c.key, v != null ? c.fmt(v) : '—']
      }),
    ),
  }))
}

export default function Derivatives() {
  const wl = useWatchlist()
  const symbols = wl.data?.symbols ?? []
  const ts = symbols[0]?.metrics.price?.ts

  return (
    <PageShell
      title="持仓 · 衍生品"
      sub="合约市场仓位与情绪。期权(DVOL/ATM IV/PCR/最大痛点)仅 BTC/ETH/SOL/XRP 有"
      controls={<Freshness ts={ts} />}
    >
      <DataTable cols={COLS.map((c) => ({ key: c.key, label: c.label }))} rows={buildRows(symbols)} loading={wl.loading} />
      <p className="mt-3 text-xs text-zinc-400">
        基差/资金费为正=升水·多头付费；多空比&gt;1=偏多。数字为各源最新采样值，每 15 分钟刷新。
      </p>
    </PageShell>
  )
}
