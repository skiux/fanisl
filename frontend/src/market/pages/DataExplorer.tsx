import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, MagnifyingGlass } from '@phosphor-icons/react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  fetchAvailable,
  fetchCatalog,
  fetchMetrics,
  type CatalogMetric,
  type MetricCoverage,
} from '../../api'
import { ChartSkeleton, EmptyState, Kpi, KpiRow, PageShell, Panel, SegTabs } from '../ui'
import { fmtByUnit, fmtDay, fmtNum, fmtSpan, sinceFromHours } from '../format'

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'ZEC/USDT', 'GLOBAL']

const CATS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'technical', label: '技术' },
  { key: 'derivatives', label: '衍生品' },
  { key: 'microstructure', label: '盘口' },
  { key: 'onchain', label: '链上' },
  { key: 'sentiment', label: '情绪' },
  { key: 'macro', label: '宏观' },
  { key: 'event', label: '事件' },
]

const RANGES: { value: string; label: string; hours: number | null }[] = [
  { value: '7d', label: '7天', hours: 168 },
  { value: '30d', label: '30天', hours: 720 },
  { value: '90d', label: '90天', hours: 2160 },
  { value: 'all', label: '全部', hours: null },
]

type Merged = CatalogMetric & MetricCoverage

// 客户端抽稀到至多 n 点，保留首尾，画图更快
function downsample<T>(arr: T[], n = 420): T[] {
  if (arr.length <= n) return arr
  const step = (arr.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)])
}

export default function DataExplorer() {
  const [catalog, setCatalog] = useState<Record<string, CatalogMetric>>({})
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')
  const [coverage, setCoverage] = useState<MetricCoverage[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState('all')
  const [series, setSeries] = useState<{ t: number; v: number }[]>([])
  const [loadingChart, setLoadingChart] = useState(false)

  useEffect(() => {
    fetchCatalog()
      .then((d) => setCatalog(Object.fromEntries(d.metrics.map((m) => [m.name, m]))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoadingList(true)
    fetchAvailable(symbol)
      .then((cov) => setCoverage(cov))
      .catch(() => setCoverage([]))
      .finally(() => setLoadingList(false))
  }, [symbol])

  // 合并 catalog（定义）+ coverage（该标的实际数据）
  const merged: Merged[] = useMemo(() => {
    return coverage.map((c) => {
      const def = catalog[c.metric]
      return {
        ...c,
        name: c.metric,
        category: def?.category ?? 'other',
        unit: def?.unit ?? 'num',
        scope: def?.scope ?? 'symbol',
        label: def?.label ?? c.metric,
        ts_meaning: def?.ts_meaning ?? '',
      }
    })
  }, [coverage, catalog])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: merged.length }
    for (const x of merged) m[x.category] = (m[x.category] ?? 0) + 1
    return m
  }, [merged])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return merged
      .filter((m) => (cat === 'all' || m.category === cat))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [merged, cat, query])

  // 默认选中（price 优先）
  useEffect(() => {
    if (merged.length === 0) {
      setSelected(null)
      return
    }
    if (!selected || !merged.some((m) => m.name === selected)) {
      setSelected(merged.find((m) => m.name === 'price')?.name ?? merged[0].name)
    }
  }, [merged]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSeries = useCallback(async (name: string, rng: string) => {
    setLoadingChart(true)
    try {
      const since = sinceFromHours(RANGES.find((r) => r.value === rng)?.hours ?? null)
      const data = await fetchMetrics(symbol, [name], since)
      const pts = (data[name] ?? []).map((p) => ({ t: new Date(p.ts).getTime(), v: p.value }))
      setSeries(downsample(pts))
    } catch {
      setSeries([])
    } finally {
      setLoadingChart(false)
    }
  }, [symbol])

  useEffect(() => {
    if (selected) loadSeries(selected, range)
  }, [selected, range, loadSeries])

  const sel = selected ? merged.find((m) => m.name === selected) : undefined
  const stats = useMemo(() => {
    if (series.length === 0) return null
    const vs = series.map((p) => p.v)
    return { min: Math.min(...vs), max: Math.max(...vs), n: series.length }
  }, [series])

  return (
    <PageShell
      title="数据总览"
      sub="所有已采集/回填的指标——选标的与指标，看完整历史"
      controls={
        <SegTabs
          size="sm"
          value={symbol}
          onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s === 'GLOBAL' ? '全市场' : s.replace('/USDT', '') }))}
        />
      }
    >
      {/* 类别筛选 + 搜索 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {CATS.map((c) => {
          const n = counts[c.key] ?? 0
          if (c.key !== 'all' && n === 0) return null
          const on = cat === c.key
          return (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors active:translate-y-px ${
                on ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 ring-1 ring-zinc-200 hover:text-zinc-800'
              }`}
            >
              {c.label}<span className={`ml-1 ${on ? 'text-zinc-400' : 'text-zinc-300'}`}>{n}</span>
            </button>
          )
        })}
        <div className="relative ml-auto">
          <MagnifyingGlass size={14} weight="bold" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索指标…"
            className="w-44 rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] outline-none focus:border-zinc-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* 左：指标列表 */}
        <div className="lg:col-span-5">
          <Panel title={`指标 · ${list.length}`}>
            {loadingList ? (
              <ChartSkeleton height={360} />
            ) : list.length === 0 ? (
              <EmptyState icon={<Database size={26} weight="thin" />} title="该标的暂无数据" hint="采集/回填后出现" />
            ) : (
              <div className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto">
                {list.map((m) => {
                  const on = m.name === selected
                  return (
                    <button
                      key={m.name}
                      onClick={() => setSelected(m.name)}
                      className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition-colors ${
                        on ? 'bg-emerald-50/60' : 'hover:bg-zinc-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-zinc-800">{m.label}</div>
                        <div className="truncate font-mono text-[11px] text-zinc-400">{m.name}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[13px] tabular-nums text-zinc-800">{fmtByUnit(m.last_value, m.unit)}</div>
                        <div className="text-[10px] text-zinc-400">{m.samples.toLocaleString()} 点 · {fmtSpan(m.first_ts, m.last_ts)}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* 右：选中指标的图表 + 统计 */}
        <div className="lg:col-span-7">
          <Panel>
            {!sel ? (
              <EmptyState title="选一个指标查看历史" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-semibold tracking-tight text-zinc-900">{sel.label}</div>
                    <div className="font-mono text-[11px] text-zinc-400">{sel.name} · {sel.category}</div>
                  </div>
                  <SegTabs size="sm" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
                </div>

                <KpiRow>
                  <Kpi label="最新" value={fmtByUnit(sel.last_value, sel.unit)} />
                  <Kpi label="最低" value={stats ? fmtByUnit(stats.min, sel.unit) : '—'} />
                  <Kpi label="最高" value={stats ? fmtByUnit(stats.max, sel.unit) : '—'} />
                  <Kpi label="样本" value={sel.samples.toLocaleString()} />
                  <Kpi label="跨度" value={fmtSpan(sel.first_ts, sel.last_ts)} />
                  <Kpi label="起始" value={fmtDay(sel.first_ts)} />
                </KpiRow>

                <div className="mt-3 h-[300px]">
                  {loadingChart ? (
                    <ChartSkeleton height={300} />
                  ) : series.length === 0 ? (
                    <EmptyState title="该区间无数据" hint="换更长的区间试试" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#f4f4f5" vertical={false} />
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          scale="time"
                          tickFormatter={(t) => fmtDay(new Date(t).toISOString())}
                          tick={{ fontSize: 11, fill: '#a1a1aa' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e4e4e7' }}
                          minTickGap={48}
                        />
                        <YAxis
                          width={56}
                          tick={{ fontSize: 11, fill: '#a1a1aa', fontFamily: 'Geist Mono' }}
                          tickFormatter={(v) => fmtNum(v)}
                          tickLine={false}
                          axisLine={false}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, fontFamily: 'Geist Mono' }}
                          labelFormatter={(t) => fmtDay(new Date(t as number).toISOString())}
                          formatter={(v: number) => [fmtByUnit(v, sel.unit), sel.label]}
                        />
                        <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={1.5} fill="url(#g)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {sel.ts_meaning && (
                  <div className="mt-2 text-[11px] text-zinc-400">
                    时间含义：{sel.ts_meaning}{sel.ts_meaning === 'reference_period' ? '（数据参考期，非发布时刻）' : ''}
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}
