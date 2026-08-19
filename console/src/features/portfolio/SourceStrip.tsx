import { useState } from 'react'
import { ArrowsClockwise, CaretDown } from '@phosphor-icons/react'
import { StatusDot } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { clockTime, freshnessOf, relativeTime, SOURCE_LABEL } from '../../lib/format'
import type { SourceState } from '../../api/types'

const STATUS_TEXT: Record<SourceState['status'], string> = {
  ok: '正常',
  unreachable: '不可达',
  unauthorized: '未授权',
  rate_limited: '限流',
  unsupported: '未启用',
}

/**
 * 九个来源压成一行。健康时安静，出问题才展开——面板在有事发生时才长大。
 */
export function SourceStrip({ sources, asOf, onRefresh, refreshing }: {
  sources: SourceState[]
  asOf: string | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const degraded = sources.filter((source) => source.status !== 'ok')
  const [open, setOpen] = useState(false)
  const { level } = freshnessOf(asOf)
  const bad = degraded.length > 0

  return (
    <div className="rounded-[var(--radius-panel)] border border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <StatusDot level={bad ? 'error' : level} />
        <span className="text-xs text-fg-2">
          {bad
            ? `${degraded.length} / ${sources.length} 个来源异常`
            : `${sources.length} 个来源正常`}
        </span>
        <span className="tnum text-xs text-fg-3">
          {relativeTime(asOf)}
          {asOf && ` · ${clockTime(asOf)}`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {bad && (
            <button
              aria-expanded={open}
              className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              明细
              <CaretDown className={cn('transition-transform duration-300', open && 'rotate-180')} size={12} />
            </button>
          )}
          <button
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg active:translate-y-px disabled:opacity-40"
            disabled={refreshing}
            onClick={onRefresh}
            type="button"
          >
            <ArrowsClockwise className={cn(refreshing && 'animate-spin')} size={12} />
            重新取数
          </button>
        </div>
      </div>

      {bad && (
        <div className="collapsible" data-open={open}>
          <div>
            <ul className="divide-y divide-line border-t border-line">
              {degraded.map((source) => (
                <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5" key={source.key}>
                  <span className="text-xs text-fg-2">{SOURCE_LABEL[source.key] ?? source.key}</span>
                  <span className="text-xs text-loss">{STATUS_TEXT[source.status]}</span>
                  <span className="tnum ml-auto text-micro text-fg-3">
                    {source.as_of ? `上次成功 ${clockTime(source.as_of)}` : '从未成功'}
                  </span>
                  {source.detail && (
                    <p className="w-full text-micro leading-relaxed text-fg-3">{source.detail}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
