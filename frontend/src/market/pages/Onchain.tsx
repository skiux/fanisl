import type { WatchlistEntry } from '../../types'
import { fmtNum, fmtUsd } from '../format'
import { useWatchlist } from '../useMarketData'
import { DataTable, Freshness, PageShell, Panel } from '../ui'

const usd = (v: number) => fmtUsd(v)
const int = (v: number) => fmtNum(v)

const COLS: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: 'chain_tvl', label: '公链 TVL', fmt: usd },
  { key: 'active_addresses', label: '活跃地址', fmt: int },
  { key: 'tx_count', label: '交易笔数', fmt: int },
  { key: 'fees_usd', label: '手续费', fmt: usd },
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

export default function Onchain() {
  const wl = useWatchlist()
  const symbols = wl.data?.symbols ?? []
  const stable = wl.data?.global.stablecoin_total?.value
  const ts = symbols[0]?.metrics.chain_tvl?.ts ?? wl.data?.global.stablecoin_total?.ts

  return (
    <PageShell
      title="链上数据"
      sub="稳定币干火药、公链 TVL、网络使用度。活跃地址/交易/手续费目前仅 BTC"
      controls={<Freshness ts={ts} />}
    >
      <div className="mb-4">
        <Panel title="稳定币总供应 · 全市场">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-900">{fmtUsd(stable)}</span>
            <span className="text-xs text-zinc-400">场内干火药</span>
          </div>
        </Panel>
      </div>
      <DataTable cols={COLS.map((c) => ({ key: c.key, label: c.label }))} rows={buildRows(symbols)} loading={wl.loading} />
      <p className="mt-3 text-xs text-zinc-400">
        交易所流入流出、MVRV/SOPR、巨鲸标签等需付费源，暂未接入（见 doc/data-upgrades.md）。
      </p>
    </PageShell>
  )
}
