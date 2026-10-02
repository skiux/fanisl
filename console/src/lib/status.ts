import { freshnessOf, relativeTime, SOURCE_LABEL } from './format'
import type { SourceState } from '../api/types'

export type DataLevel = 'ok' | 'warn' | 'error'

/**
 * 报头时间右边那盏灯：这一页的数字现在可不可信。
 *
 * 原先是一条「已过期」横幅压在页面最上面，外加整页蒙灰。页面在前台会自己刷新以后
 * （lib/autoRefresh.ts），横幅多半只在切回标签页那一两秒里闪一下，却每次都把整页
 * 往下推一截。现在收成一盏灯，原因放在悬停提示里：
 *
 *   绿  数据在 20 分钟以内，来源都取到了
 *   黄  有来源没取到，或者刚才那次自动刷新失败了（手上的数据还不旧）；
 *       数据已经旧了、但新的一次正在路上，也先是黄
 *   红  数据超过 20 分钟，而且没有在更新——自动刷新一直失败
 *
 * 20 分钟沿用原先「已过期」的界线（`freshnessOf`）。`unsupported` 是账户没开这项功能，
 * 不算没取到。
 */
export function dataStatus({ asOf, sources, refreshError = null, syncing = false }: {
  asOf: string | null
  sources: SourceState[]
  refreshError?: string | null
  syncing?: boolean
}): { level: DataLevel; text: string } {
  const { level: freshness } = freshnessOf(asOf)
  const stale = freshness === 'stale' || freshness === 'unknown'
  if (stale && !syncing) {
    const reason = refreshError ? `，自动刷新失败：${refreshError}` : ''
    return { level: 'error', text: asOf ? `数据停在 ${relativeTime(asOf)}${reason}` : `还没有取到数据${reason}` }
  }
  if (stale) return { level: 'warn', text: '正在更新' }
  if (refreshError) return { level: 'warn', text: `自动刷新失败：${refreshError}` }
  const missing = sources.filter((source) => source.status !== 'ok' && source.status !== 'unsupported')
  if (missing.length > 0) {
    const names = missing.map((source) => SOURCE_LABEL[source.key] ?? source.key).join('、')
    return { level: 'warn', text: `${missing.length} 个来源未取到：${names}` }
  }
  return { level: 'ok', text: '数据正常' }
}
