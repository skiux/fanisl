import { CalendarBlank, LockKey, Newspaper } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { CatalystItem } from '../../types'
import { fmtDay } from '../format'
import { useCatalysts, useWatchlist } from '../useMarketData'
import { Badge, EmptyState, Panel, PageShell, SegTabs } from '../ui'

export default function Catalysts() {
  const wl = useWatchlist()
  const [sym, setSym] = useState<string | null>(null)
  const options = (wl.data?.symbols ?? []).map((s) => ({ value: s.symbol, label: s.symbol.replace('/USDT', '') }))
  useEffect(() => {
    if (!sym && options.length) setSym(options[0].value)
  }, [sym, options])

  const { data, loading } = useCatalysts(sym)
  const items = data ?? []
  const unlocks = items.filter((i) => i.kind === 'unlock')
  const macro = items.filter((i) => i.kind === 'macro')
  const news = items.filter((i) => i.kind === 'news')

  return (
    <PageShell
      title="事件 · 催化剂"
      sub="与价格正交、需要推理的信息：代币解锁、宏观日历、新闻"
      controls={options.length > 0 && sym ? <SegTabs options={options} value={sym} onChange={setSym} size="sm" /> : undefined}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="新闻">
            {news.length === 0 ? (
              <EmptyState icon={<Newspaper size={28} weight="thin" />} title={loading ? '加载中' : '暂无新闻'} />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {news.slice(0, 14).map((n, i) => (
                  <NewsRow key={i} item={n} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-3">
          <Panel title="代币解锁">
            {unlocks.length === 0 ? (
              <EmptyState icon={<LockKey size={26} weight="thin" />} title={loading ? '加载中' : '无即将解锁'} hint="非归属代币（如 BTC）无解锁日程" />
            ) : (
              <ul className="space-y-2.5">
                {unlocks.map((u, i) => (
                  <li key={i}>
                    <div className="font-mono text-xs text-zinc-400">{fmtDay(u.event_date)}</div>
                    <div className="text-sm text-zinc-700">{u.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="宏观日历">
            {macro.length === 0 ? (
              <EmptyState icon={<CalendarBlank size={26} weight="thin" />} title={loading ? '加载中' : '暂无'} />
            ) : (
              <ul className="space-y-2">
                {macro.map((m, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-zinc-400">{fmtDay(m.event_date)}</span>
                    <span className="text-sm text-zinc-700">{m.title}</span>
                    {m.payload?.importance === 'high' && <Badge tone="high">高</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  )
}

function NewsRow({ item }: { item: CatalystItem }) {
  const inner = (
    <div className="py-2.5">
      <div className="text-sm leading-snug text-zinc-700 group-hover:text-emerald-700">{item.title}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
        {item.payload?.source && <span>{item.payload.source}</span>}
        {item.event_date && <span className="font-mono">{fmtDay(item.event_date)}</span>}
      </div>
    </div>
  )
  return item.payload?.url ? (
    <li>
      <a href={item.payload.url} target="_blank" rel="noreferrer" className="group block">
        {inner}
      </a>
    </li>
  ) : (
    <li className="group">{inner}</li>
  )
}
