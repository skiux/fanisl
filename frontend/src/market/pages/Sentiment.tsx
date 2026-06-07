import { EyeSlash } from '@phosphor-icons/react'
import { useWatchlist } from '../useMarketData'
import { EmptyState, Freshness, PageShell, Panel } from '../ui'

function zoneLabel(v: number | null): string {
  if (v == null) return ''
  if (v <= 24) return '极度恐惧'
  if (v <= 44) return '恐惧'
  if (v <= 55) return '中性'
  if (v <= 74) return '贪婪'
  return '极度贪婪'
}

function zoneColor(v: number | null): string {
  if (v == null) return '#71717a'
  if (v <= 24) return '#e11d48'
  if (v <= 44) return '#ea580c'
  if (v <= 55) return '#d97706'
  if (v <= 74) return '#65a30d'
  return '#059669'
}

export default function Sentiment() {
  const wl = useWatchlist()
  const fg = wl.data?.global.fear_greed?.value ?? null
  const ts = wl.data?.global.fear_greed?.ts

  return (
    <PageShell
      title="情绪 · 注意力"
      sub="反身性、叙事驱动维度——当确认信号用，极值是反指"
      controls={<Freshness ts={ts} />}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="恐惧贪婪指数 · 全市场">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-5xl font-semibold tabular-nums" style={{ color: zoneColor(fg) }}>
              {fg ?? '—'}
            </span>
            <span className="text-base font-medium" style={{ color: zoneColor(fg) }}>
              {zoneLabel(fg)}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-400">0 极度恐惧 → 100 极度贪婪。极值往往是反指。</p>
        </Panel>

        <div className="lg:col-span-2">
          <Panel title="社交热度与注意力">
            <EmptyState
              icon={<EyeSlash size={30} weight="thin" />}
              title="社交数据暂缺"
              hint="LunarCrush API 2026 起转付费、免费档已停；Santiment 免费档社交指标滞后 30 天不可用。订阅后接入，见 doc/data-upgrades.md"
            />
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}
