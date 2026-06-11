import { useEffect, useMemo, useState } from 'react'
import { Database } from '@phosphor-icons/react'
import {
  fetchAvailable,
  fetchCatalog,
  fetchMetrics,
  type CatalogMetric,
  type MetricCoverage,
} from '../../api'
import { ChartSkeleton, EmptyState, PageShell, SegTabs, Sparkline } from '../ui'
import { fmtByUnit, fmtSpan } from '../format'

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'ZEC/USDT', 'GLOBAL']

type Card = CatalogMetric & MetricCoverage & { spark: number[] }

function downsample(vs: number[], n = 40): number[] {
  if (vs.length <= n) return vs
  const step = (vs.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => vs[Math.round(i * step)])
}

// 单类别数据页：分类显示数据总览中的数据（技术/衍生品/盘口/链上/情绪/宏观各一页）
export default function Categories({
  category, title, sub, defaultSymbol = 'BTC/USDT',
}: {
  category: string
  title: string
  sub: string
  defaultSymbol?: string
}) {
  const [catalog, setCatalog] = useState<Record<string, CatalogMetric>>({})
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCatalog()
      .then((d) => setCatalog(Object.fromEntries(d.metrics.map((m) => [m.name, m]))))
      .catch(() => {})
  }, [])

  useEffect(() => setSymbol(defaultSymbol), [defaultSymbol, category])

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const cov = await fetchAvailable(symbol)
        const wanted = cov.filter((c) => (catalog[c.metric]?.category ?? 'other') === category)
        const names = wanted.map((c) => c.metric)
        const since = new Date(Date.now() - 365 * 86400000).toISOString()
        const series = names.length ? await fetchMetrics(symbol, names, since) : {}
        if (!alive) return
        setCards(
          wanted.map((c) => {
            const def = catalog[c.metric]!
            const vs = (series[c.metric] ?? []).map((p) => p.value)
            return { ...c, ...def, name: c.metric, spark: downsample(vs) }
          }),
        )
      } catch {
        if (alive) setCards([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [symbol, catalog, category])

  const sorted = useMemo(() => [...cards].sort((a, b) => a.name.localeCompare(b.name)), [cards])

  return (
    <PageShell
      title={title}
      sub={sub}
      controls={
        <SegTabs
          size="sm" value={symbol} onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s === 'GLOBAL' ? '全市场' : s.replace('/USDT', '') }))}
        />
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <ChartSkeleton key={i} height={92} />)}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Database size={28} weight="thin" />}
          title="该标的此类别暂无数据"
          hint={symbol !== 'GLOBAL' ? '情绪/宏观等全市场数据请切到「全市场」' : '采集/回填后出现'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((m) => <MetricCard key={m.name} m={m} />)}
        </div>
      )}
    </PageShell>
  )
}

function MetricCard({ m }: { m: Card }) {
  return (
    <div className="rounded-xl border border-zinc-200/70 bg-white p-3 transition-shadow hover:shadow-[0_2px_8px_rgba(24,24,27,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-zinc-800">{m.label}</div>
          <div className="truncate font-mono text-[10px] text-zinc-400">{m.name}</div>
        </div>
        <Sparkline values={m.spark} width={84} height={26} />
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="font-mono text-[17px] font-medium tabular-nums tracking-tight text-zinc-900">
          {fmtByUnit(m.last_value, m.unit)}
        </span>
        <span className="text-[10px] text-zinc-400">{m.samples.toLocaleString()} 点 · {fmtSpan(m.first_ts, m.last_ts)}</span>
      </div>
    </div>
  )
}
