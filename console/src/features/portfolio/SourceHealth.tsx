import { StatusDot } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { freshnessOf, relativeTime, SOURCE_LABEL } from '../../lib/format'
import type { SourceState, SourceStatus } from '../../api/types'

const STATUS_TEXT: Record<SourceStatus, string> = {
  ok: '正常',
  unreachable: '不可达',
  unauthorized: '无权限',
  rate_limited: '被限流',
  unsupported: '不支持',
}

/**
 * 每个来源自己的健康度与新鲜度。报头只给一个「9 个来源正常」的合计，
 * 而整份报表以"取不到就留空"为准——空着的到底是哪一项、空了多久，得有地方能查。
 * 这是总览独有的一问：这些数字有多可信。
 */
export function SourceHealth({ sources }: { sources: SourceState[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-ink-3">没有来源信息。</p>
  }
  return (
    <ul className="grid gap-x-10 gap-y-px sm:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => {
        const ok = source.status === 'ok'
        return (
          <li
            className="flex items-center gap-2.5 border-b border-rule py-2.5"
            key={source.key}
            title={source.detail ?? undefined}
          >
            <StatusDot level={ok ? freshnessOf(source.as_of).level : 'error'} />
            <span className="min-w-0 truncate text-xs text-ink-2">
              {SOURCE_LABEL[source.key] ?? source.key}
            </span>
            <span className={cn('ml-auto shrink-0 whitespace-nowrap text-xs', ok ? 'text-ink-3' : 'text-loss')}>
              {ok ? relativeTime(source.as_of) : STATUS_TEXT[source.status]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
