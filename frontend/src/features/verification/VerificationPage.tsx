import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import { outcomeLabels, verifiabilityLabels } from '../../shared/knowledge/labels'
import {
  benchmarkText,
  realizedSummary,
  scoringMethodText,
  subjectText,
  symbolText,
  thesisText,
} from '../../shared/knowledge/claim'
import '../../shared/layout/chassis.css'
import { VerificationReader } from './VerificationDossier'
import type {
  DueVerification,
  ScoredVerification,
  VerificationQueue,
} from './types'
import './verification.css'

type QueueView = 'recent' | 'due' | 'review' | 'unavailable'
type QueueItem = DueVerification | ScoredVerification
type LoadState = 'loading' | 'loaded' | 'error'

const queueLabels: Record<QueueView, string> = {
  recent: '已判定',
  due: '待到期',
  review: '需复核',
  unavailable: '不可判定',
}

const queueDescriptions: Record<QueueView, string> = {
  recent: '评分器已机械执行的时点，按到期日排列。',
  due: '判据已冻结、尚未到期的时点。到期前只观察。',
  review: '条件未触发或仍为 pending，保留上下文继续观察。',
  unavailable: '无法取价或条件不可机械验证。空白本身是质量信号。',
}

function isScored(item: QueueItem): item is ScoredVerification {
  return 'score_id' in item
}

function itemKey(item: QueueItem) {
  return isScored(item) ? `score-${item.score_id}` : `due-${item.unit_id}-${item.horizon_label}`
}

/**
 * 排序键一律用 horizon_label（到期日），不用 scored_at。
 * 评分是批跑的：56 条已判定里 54 条的 scored_at 是同一分钟，
 * 拿它排序或显示，整个队列就变成一面相同的时间戳。
 */
function horizonKey(item: QueueItem) {
  return item.horizon_label ?? ''
}

function daysFromToday(dateText: string) {
  if (!dateText) return null
  const target = Date.parse(`${dateText}T00:00:00+08:00`)
  if (Number.isNaN(target)) return null
  return Math.round((target - Date.now()) / 86_400_000)
}

function relativeDay(dateText: string) {
  const days = daysFromToday(dateText)
  if (days === null) return null
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days > 0) return `${days} 天后`
  if (days === -1) return '昨天'
  return `${-days} 天前`
}

function VerificationRow({
  item,
  onOpen,
  selected,
}: {
  item: QueueItem
  onOpen: (item: QueueItem) => void
  selected: boolean
}) {
  const payload = item.payload
  const scored = isScored(item)
  const symbol = symbolText(payload)
  const grade = typeof payload.verifiability === 'string' ? payload.verifiability : null
  const method = scoringMethodText(payload)
  const benchmark = benchmarkText(payload)
  const realized = scored ? realizedSummary(item.realized) : null

  return (
    <button
      aria-pressed={selected}
      className={`verify-row ${scored ? `outcome-${item.outcome}` : 'outcome-due'}`}
      onClick={() => onOpen(item)}
      type="button"
    >
      <span className="verify-verdict">
        {scored ? (
          <b>{outcomeLabels[item.outcome] ?? item.outcome}</b>
        ) : (
          <b className="verdict-due">{relativeDay(item.horizon_label) ?? '待到期'}</b>
        )}
        <time>{item.horizon_label}</time>
      </span>

      <span className="verify-body">
        <span className="verify-head">
          {symbol && <em>{symbol}</em>}
          <strong>{subjectText(payload)}</strong>
        </span>
        <span className="verify-thesis">
          {thesisText(payload) && <b>{thesisText(payload)}</b>}
          {method && <span>{method}{benchmark ? ` vs ${benchmark}` : ''}</span>}
          {grade && <i>{grade} 级 · {verifiabilityLabels[grade]}</i>}
        </span>
        <span className="verify-quote">{item.quote}</span>
        <span className="verify-foot">
          <span>{item.creator}</span>
          <span>发布 {String(item.published_at).slice(0, 10)}</span>
          {realized && <span className="verify-realized">{realized}</span>}
        </span>
      </span>
    </button>
  )
}

function VerificationPage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<VerificationQueue | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [windowDays, setWindowDays] = useState(14)
  const [view, setView] = useState<QueueView>('recent')
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<QueueItem | null>(null)
  const [unitOpen, setUnitOpen] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    apiJson<VerificationQueue>(`/knowledge/verification-queue?days=${windowDays}&limit=120`, {
      signal: controller.signal,
    }).then((payload) => {
      setQueue(payload)
      setLoadState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState('error')
    })
    return () => controller.abort()
  }, [requestKey, windowDays])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      if (unitOpen !== null) { setUnitOpen(null); return }
      if (openItem) { setOpenItem(null); return }
      if (query) setQuery('')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [openItem, query, unitOpen])

  const allItems = useMemo(() => queue
    ? [...queue.recent, ...queue.due, ...queue.review, ...queue.unavailable]
    : [], [queue])

  const creators = useMemo(() => {
    const counts = new Map<string, number>()
    allItems.forEach((item) => counts.set(item.creator, (counts.get(item.creator) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [allItems])

  const viewItems = useMemo(() => {
    const rows = [...(queue?.[view] ?? [])]
    // 已判定按到期日倒序（最近结算的在前）；待到期按到期日正序（最先到期的在前）
    rows.sort((a, b) => view === 'due'
      ? horizonKey(a).localeCompare(horizonKey(b))
      : horizonKey(b).localeCompare(horizonKey(a)))
    return rows
  }, [queue, view])

  const visibleItems = useMemo(() => {
    const text = query.trim().toLocaleLowerCase()
    return viewItems.filter((item) => {
      if (creator && item.creator !== creator) return false
      if (!text) return true
      return `${item.quote} ${item.creator} ${item.content_title} ${JSON.stringify(item.payload)}`
        .toLocaleLowerCase().includes(text)
    })
  }, [creator, query, viewItems])

  const overview = queue?.overview ?? { due: 0, completed: 0, unavailable: 0, review: 0 }
  const queueCounts: Record<QueueView, number> = {
    recent: overview.completed,
    due: overview.due,
    review: overview.review,
    unavailable: overview.unavailable,
  }

  const hitStats = useMemo(() => {
    const scored = queue?.recent ?? []
    const hit = scored.filter((item) => item.outcome === 'hit').length
    const partial = scored.filter((item) => item.outcome === 'partial').length
    const miss = scored.filter((item) => item.outcome === 'miss').length
    const n = hit + partial + miss
    return { hit, partial, miss, n, rate: n ? Math.round(((hit + partial * 0.5) / n) * 100) : null }
  }, [queue])

  const selectView = (next: QueueView) => {
    setView(next)
    setOpenItem(null)
    setUnitOpen(null)
  }

  const hasFilters = Boolean(query.trim()) || creator !== null
  const inDetail = openItem !== null

  const openIndex = openItem ? visibleItems.findIndex((row) => itemKey(row) === itemKey(openItem)) : -1
  const step = (delta: number) => {
    const next = visibleItems[openIndex + delta]
    if (next) {
      setOpenItem(next)
      setUnitOpen(null)
    }
  }

  /** 到期日分组：今天之前 / 本周 / 更远，或已判定按月 */
  const groupLabel = (item: QueueItem) => {
    if (view !== 'due') return item.horizon_label.slice(0, 7).replace('-', ' 年 ') + ' 月到期'
    const days = daysFromToday(item.horizon_label)
    if (days === null) return '日期未知'
    if (days <= 0) return '已过期未评分'
    if (days <= 7) return '未来 7 天'
    if (days <= 30) return '未来 30 天'
    return '更远'
  }

  return (
    <div className="page-shell verification-page">
      <div aria-hidden="true" className="verification-material" />
      <AppHeader current="verification" onSearch={() => searchRef.current?.focus()} />

      <main className="page-stage">
        <header className="page-masthead">
          <h1>验证</h1>
          <div className="page-facts">
            <span><b>{overview.completed}</b> 已判定</span><i />
            {hitStats.rate !== null && (
              <>
                <span>
                  加权命中率 <b>{hitStats.rate}%</b>（n={hitStats.n}）
                </span><i />
              </>
            )}
            <span><b>{overview.due}</b> 条在 {windowDays} 天内到期</span>
          </div>
        </header>

        <nav aria-label="验证队列" className="page-tabs">
          {(Object.keys(queueLabels) as QueueView[]).map((item) => (
            <button
              aria-pressed={view === item}
              key={item}
              onClick={() => selectView(item)}
              type="button"
            >
              {queueLabels[item]}<b>{loadState === 'loading' ? '—' : queueCounts[item]}</b>
            </button>
          ))}
        </nav>

        <div className="page-body">
          <aside className="page-rail">
            {inDetail ? (
              <>
                <button className="rail-back" onClick={() => { setOpenItem(null); setUnitOpen(null) }} type="button">
                  ← 返回{queueLabels[view]}
                </button>
                {openIndex >= 0 && (
                  <div className="rail-step">
                    <button disabled={openIndex <= 0} onClick={() => step(-1)} type="button">↑</button>
                    <button disabled={openIndex >= visibleItems.length - 1} onClick={() => step(1)} type="button">↓</button>
                    <span>{openIndex + 1} / {visibleItems.length}</span>
                  </div>
                )}
                <p className="rail-note">判据在发布时冻结，到期只读价格并执行规则。</p>
              </>
            ) : (
              <>
                {view === 'due' && (
                  <div className="rail-block">
                    <p>到期窗口</p>
                    <div className="rail-window">
                      {[7, 14, 30, 90].map((days) => (
                        <button
                          aria-pressed={windowDays === days}
                          key={days}
                          onClick={() => setWindowDays(days)}
                          type="button"
                        >
                          {days}天
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {creators.length > 0 && (
                  <div className="rail-block">
                    <p>信源</p>
                    <button aria-pressed={creator === null} onClick={() => setCreator(null)} type="button">
                      <span>全部</span>
                    </button>
                    {creators.map(([name, count]) => (
                      <button
                        aria-pressed={creator === name}
                        key={name}
                        onClick={() => setCreator(name)}
                        type="button"
                      >
                        <span>{name}</span><b>{count}</b>
                      </button>
                    ))}
                  </div>
                )}

                {view === 'recent' && hitStats.n > 0 && (
                  <div className="rail-block">
                    <p>已判定构成</p>
                    <p className="rail-note">
                      命中 {hitStats.hit} · 部分 {hitStats.partial} · 未中 {hitStats.miss}
                      <br />
                      条件类与不可评类不进分母。
                      {hitStats.n < 30 && ' 样本仍小，只作跟踪。'}
                    </p>
                  </div>
                )}
              </>
            )}
          </aside>

          <div className="page-main">
            {!inDetail && (
              <>
                <div className="main-toolbar">
                  <label>
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="检索验证队列"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="检索标的、信源或引文"
                      ref={searchRef}
                      value={query}
                    />
                  </label>
                </div>
                <div className="main-count">
                  <span>
                    <strong>{loadState === 'loading' ? '—' : visibleItems.length}</strong> 条
                    {' · '}{queueDescriptions[view]}
                  </span>
                  {hasFilters && (
                    <button onClick={() => { setQuery(''); setCreator(null) }} type="button">清除条件</button>
                  )}
                </div>
              </>
            )}

            {loadState === 'loading' && <div className="page-skeleton"><i /><i /><i /></div>}

            {loadState === 'error' && (
              <div className="page-error">
                <strong>验证队列没有载入</strong>
                <p>页面不会用预览数字代替真实裁决。</p>
                <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取</button>
              </div>
            )}

            {loadState === 'loaded' && inDetail && openItem && (
              <VerificationReader
                dueHorizon={isScored(openItem) ? null : openItem.horizon_label}
                dueUnitId={isScored(openItem) ? null : openItem.unit_id}
                onCloseUnit={() => setUnitOpen(null)}
                onOpenUnit={setUnitOpen}
                scoreId={isScored(openItem) ? openItem.score_id : null}
                unitOpen={unitOpen}
              />
            )}

            {loadState === 'loaded' && !inDetail && visibleItems.length > 0 && (
              <div className="verify-list">
                {visibleItems.map((item, index) => {
                  const label = groupLabel(item)
                  const previous = index > 0 ? groupLabel(visibleItems[index - 1]) : null
                  return (
                    <div key={itemKey(item)}>
                      {label !== previous && <p className="list-month">{label}</p>}
                      <VerificationRow item={item} onOpen={setOpenItem} selected={false} />
                    </div>
                  )
                })}
              </div>
            )}

            {loadState === 'loaded' && !inDetail && visibleItems.length === 0 && (
              <div className="page-empty">
                <strong>{hasFilters ? '当前条件没有匹配记录' : `${queueLabels[view]}队列为空`}</strong>
                <p>{hasFilters ? '清除检索或信源条件即可恢复队列。' : queueDescriptions[view]}</p>
                {hasFilters && (
                  <button onClick={() => { setQuery(''); setCreator(null) }} type="button">清除全部条件</button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default VerificationPage
