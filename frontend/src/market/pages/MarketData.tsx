import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fetchAvailable, fetchCatalog, fetchMetrics } from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate, type Route } from '../../lib/router'
import {
  AsOf, CHART, EmptyState, ErrorState, PageShell, Panel, QueryGate, SegTabs, Skeleton, Statline,
} from '../ui'
import { fmtByUnit, fmtDay, fmtNum, fmtSpan, sinceFromHours } from '../format'

// 市场数据（证据基底，Instrument 容器）：单页仪器=标的×分类筛选×指标列表×序列图。
// 原六个分类页并入此处的分类筛选（UX Audit S2 执行）。URL 即状态（#/data?symbol=&cat=&metric=）。

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

// 客户端抽稀到至多 n 点，保留首尾，画图更快
function downsample<T>(arr: T[], n = 420): T[] {
  if (arr.length <= n) return arr
  const step = (arr.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)])
}

export default function MarketData({ route }: { route: Route }) {
  const symbol = route.query.get('symbol') ?? 'BTC/USDT'
  const cat = route.query.get('cat') ?? 'all'
  const urlMetric = route.query.get('metric')
  const [query, setQuery] = useState('')
  const [range, setRange] = useState('all')

  const go = (next: { symbol?: string; cat?: string; metric?: string | null }) => {
    const q = new URLSearchParams()
    const s = next.symbol ?? symbol
    const c = next.cat ?? cat
    const m = next.metric === undefined ? urlMetric : next.metric
    if (s !== 'BTC/USDT') q.set('symbol', s)
    if (c !== 'all') q.set('cat', c)
    if (m) q.set('metric', m)
    const qs = q.toString()
    navigate(`/data${qs ? `?${qs}` : ''}`)
  }

  const catalog = useQuery(() => fetchCatalog(), [])
  const coverage = useQuery(() => fetchAvailable(symbol), [symbol], { pollMs: 60000 })

  // 合并 catalog（定义）+ coverage（该标的实际数据）
  const merged = useMemo(() => {
    const defs = Object.fromEntries((catalog.data?.metrics ?? []).map((m) => [m.name, m]))
    return (coverage.data ?? []).map((c) => {
      const def = defs[c.metric]
      return {
        ...c,
        name: c.metric,
        category: def?.category ?? 'other',
        unit: def?.unit ?? 'num',
        label: def?.label ?? c.metric,
        ts_meaning: def?.ts_meaning ?? '',
      }
    })
  }, [coverage.data, catalog.data])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: merged.length }
    for (const x of merged) m[x.category] = (m[x.category] ?? 0) + 1
    return m
  }, [merged])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return merged
      .filter((m) => cat === 'all' || m.category === cat)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [merged, cat, query])

  // 选中指标：URL 优先，无效则回退 price / 第一个
  const selected = useMemo(() => {
    if (urlMetric && merged.some((m) => m.name === urlMetric)) return urlMetric
    if (merged.some((m) => m.name === 'price')) return 'price'
    return merged[0]?.name ?? null
  }, [urlMetric, merged])

  const series = useQuery(async () => {
    if (!selected) return []
    const since = sinceFromHours(RANGES.find((r) => r.value === range)?.hours ?? null)
    const data = await fetchMetrics(symbol, [selected], since)
    return downsample((data[selected] ?? []).map((p) => ({ t: new Date(p.ts).getTime(), v: p.value })))
  }, [symbol, selected, range])

  const sel = selected ? merged.find((m) => m.name === selected) : undefined
  const stats = useMemo(() => {
    const vs = (series.data ?? []).map((p) => p.v)
    if (vs.length === 0) return null
    return { min: Math.min(...vs), max: Math.max(...vs), n: vs.length }
  }, [series.data])

  return (
    <PageShell
      title="市场数据"
      sub={<>证据基底：已采集/回填的全部时点序列。<AsOf ts={coverage.asOf} prefix="本页截至" /></>}
      controls={
        <SegTabs size="sm" value={symbol} onChange={(s) => go({ symbol: s, metric: null })}
          options={SYMBOLS.map((s) => ({ value: s, label: s === 'GLOBAL' ? '全市场' : s.replace('/USDT', '') }))} />
      }
    >
      {/* 分类筛选（原六个分类页在此收拢）+ 搜索 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {CATS.map((c) => {
          const n = counts[c.key] ?? 0
          if (c.key !== 'all' && n === 0) return null
          const on = cat === c.key
          return (
            <button key={c.key} onClick={() => go({ cat: c.key })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 active:translate-y-px ${
                on ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 ring-1 ring-zinc-200 hover:text-zinc-800'
              }`}>
              {c.label}<span className={`ml-1 font-mono ${on ? 'text-zinc-400' : 'text-zinc-300'}`}>{n}</span>
            </button>
          )
        })}
        <div className="relative ml-auto">
          <MagnifyingGlass size={14} weight="bold" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索指标…"
            className="w-44 rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-2.5 text-sm outline-none transition-colors duration-150 focus:border-zinc-400" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* 左：指标列表 */}
        <div className="lg:col-span-5">
          <Panel title={`指标 · ${list.length}`}>
            <QueryGate q={coverage} skeletonHeight={360}>
              {() => list.length === 0 ? (
                <EmptyState title="该标的此筛选下暂无数据"
                  hint={symbol !== 'GLOBAL' && (cat === 'sentiment' || cat === 'macro')
                    ? '情绪/宏观是全市场数据，切到「全市场」'
                    : '采集/回填入库后出现'} />
              ) : (
                <div className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto">
                  {list.map((m) => {
                    const on = m.name === selected
                    return (
                      <button key={m.name} onClick={() => go({ metric: m.name })}
                        className={`flex w-full items-center justify-between gap-3 px-2 py-2 text-left transition-colors duration-150 ${
                          on ? 'bg-zinc-100' : 'hover:bg-zinc-50'
                        }`}>
                        <div className="min-w-0">
                          <div className={`truncate text-sm ${on ? 'font-medium text-zinc-900' : 'text-zinc-700'}`}>{m.label}</div>
                          <div className="truncate font-mono text-2xs text-zinc-400">{m.name}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-sm tabular-nums text-zinc-800">{fmtByUnit(m.last_value, m.unit)}</div>
                          <div className="font-mono text-2xs text-zinc-400">{fmtDay(m.last_ts)}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </QueryGate>
          </Panel>
        </div>

        {/* 右：选中指标的序列 */}
        <div className="lg:col-span-7">
          <Panel>
            {!sel ? (
              coverage.loading ? <Skeleton height={360} /> : <EmptyState title="选一个指标查看历史" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-md font-semibold tracking-tight text-zinc-900">{sel.label}</div>
                    <div className="font-mono text-2xs text-zinc-400">{sel.name} · {sel.category}</div>
                  </div>
                  <SegTabs size="sm" value={range} onChange={setRange}
                    options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
                </div>

                {/* 层级：市场事实（最新/区间）为主行；库存元数据（样本/跨度）降为注记行 */}
                <Statline items={[
                  { label: '最新', value: fmtByUnit(sel.last_value, sel.unit), title: `更新于 ${fmtDay(sel.last_ts)}` },
                  { label: '区间最低', value: stats ? fmtByUnit(stats.min, sel.unit) : '—' },
                  { label: '区间最高', value: stats ? fmtByUnit(stats.max, sel.unit) : '—' },
                ]} />
                <p className="mt-1 text-2xs text-zinc-400">
                  <AsOf ts={sel.last_ts} /> · 样本 <span className="font-mono">{sel.samples.toLocaleString()}</span> · 跨度 {fmtSpan(sel.first_ts, sel.last_ts)} · 起始 <span className="font-mono">{fmtDay(sel.first_ts)}</span>
                  {sel.ts_meaning && <> · 时间含义 {sel.ts_meaning}{sel.ts_meaning === 'reference_period' ? '（数据参考期，非发布时刻）' : ''}</>}
                </p>

                <div className="mt-3 h-[300px]">
                  {series.data == null ? (
                    series.loading ? <Skeleton height={300} />
                      : series.error ? <ErrorState error={series.error} onRetry={series.refetch} />
                      : <Skeleton height={300} />
                  ) : series.data.length === 0 ? (
                    <EmptyState title="该区间无数据" hint="换更长的区间" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke={CHART.grid.stroke} vertical={false} />
                        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
                          tickFormatter={(t) => fmtDay(new Date(t).toISOString())}
                          tick={CHART.axisTick} tickLine={false} axisLine={CHART.axisLine} minTickGap={48} />
                        <YAxis width={56} tick={CHART.axisTick} tickFormatter={(v) => fmtNum(v)}
                          tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={CHART.tooltip}
                          labelFormatter={(t) => fmtDay(new Date(t as number).toISOString())}
                          formatter={(v: number) => [fmtByUnit(v, sel.unit), sel.label]} />
                        <Line type="monotone" dataKey="v" stroke={CHART.seriesMain} strokeWidth={1.4}
                          dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}
