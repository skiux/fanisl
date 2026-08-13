import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import { VerificationReader } from './VerificationDossier'
import type {
  DueVerification,
  ScoredVerification,
  VerificationOutcome,
  VerificationPageData,
  VerificationSummary,
} from './types'
import './verification.css'

type QueueView = 'recent' | 'due' | 'watch' | 'unavailable'
type QueueItem = DueVerification | ScoredVerification
type LoadState = 'loading' | 'loaded' | 'error'

type VerificationGroup = {
  key: string
  items: QueueItem[]
  primary: QueueItem
}

type RecordRoute = {
  scoreId: number | null
  dueUnitId: number | null
  dueHorizon: string | null
}

const queueLabels: Record<QueueView, string> = {
  recent: '最新裁决',
  due: '待执行',
  watch: '观察中',
  unavailable: '质量异常',
}

const queueDescriptions: Record<QueueView, string> = {
  recent: '评分器已经按发布时冻结的判据完成执行。相同判断的多个评分时点合并展示。',
  due: '判据已经冻结、尚未到达执行日期。这里展示未来要发生的验证工作。',
  watch: '条件没有触发或结果仍待确认。继续保留语境，不把观察状态误写成错误。',
  unavailable: '价格或条件无法机械核验。异常被保留为知识质量信号，不用空白掩盖。',
}

const outcomeLabels: Record<VerificationOutcome, string> = {
  hit: '命中',
  partial: '部分命中',
  miss: '未命中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无法取价',
  pending: '等待确认',
}

const outcomeMarks: Record<VerificationOutcome, string> = {
  hit: '✓',
  partial: '½',
  miss: '×',
  condition_not_met: '○',
  condition_unverifiable: '?',
  unpriceable: '—',
  pending: '…',
}

function readRecordRoute(): RecordRoute {
  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  const score = Number(params.get('score'))
  const due = Number(params.get('due'))
  return {
    scoreId: Number.isInteger(score) && score > 0 ? score : null,
    dueUnitId: Number.isInteger(due) && due > 0 ? due : null,
    dueHorizon: params.get('horizon'),
  }
}

function isScored(item: QueueItem): item is ScoredVerification {
  return 'score_id' in item
}

function itemKey(item: QueueItem) {
  return isScored(item)
    ? `score-${item.score_id}`
    : `due-${item.unit_id}-${item.horizon_label}`
}

function groupItems(items: QueueItem[]): VerificationGroup[] {
  const groups = new Map<number, QueueItem[]>()
  items.forEach((item) => groups.set(item.unit_id, [...(groups.get(item.unit_id) ?? []), item]))
  return [...groups.entries()].map(([unitId, group]) => {
    const ordered = [...group].sort((left, right) => {
      const leftDate = isScored(left) ? left.eval_ts : left.horizon_label
      const rightDate = isScored(right) ? right.eval_ts : right.horizon_label
      return new Date(leftDate).getTime() - new Date(rightDate).getTime()
    })
    return {
      key: `unit-${unitId}`,
      items: ordered,
      primary: isScored(ordered[0]) ? ordered[ordered.length - 1] : ordered[0],
    }
  })
}

function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function dateKey(item: QueueItem) {
  const value = isScored(item) ? item.scored_at : item.horizon_label
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function formatMetric(key: string, value: unknown) {
  if (typeof value !== 'number') return null
  if (key.endsWith('_ret')) return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function itemSummary(item: ScoredVerification) {
  if (!item.realized) return '没有数值型实测字段'
  const priorities = ['eval_close', 'asset_ret', 'bench_ret', 'high', 'low']
  const parts = priorities.flatMap((key) => {
    const value = formatMetric(key, item.realized?.[key])
    return value ? [value] : []
  })
  return parts.slice(0, 2).join(' · ') || '判定字段已落库'
}

function routeFor(item: QueueItem) {
  if (isScored(item)) return `#/verification?score=${item.score_id}`
  const horizon = encodeURIComponent(item.horizon_label)
  return `#/verification?due=${item.unit_id}&horizon=${horizon}`
}

function VerificationPage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<VerificationSummary | null>(null)
  const [page, setPage] = useState<VerificationPageData | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [windowDays, setWindowDays] = useState(14)
  const [view, setView] = useState<QueueView>('recent')
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(18)
  const [unitOpen, setUnitOpen] = useState<number | null>(null)
  const [recordRoute, setRecordRoute] = useState<RecordRoute>(readRecordRoute)

  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    const bucket = view === 'watch' ? 'review' : view
    Promise.all([
      apiJson<VerificationSummary>(`/knowledge/verification-summary?days=${windowDays}`, { signal: controller.signal }),
      apiJson<VerificationPageData>(`/knowledge/verification-page?bucket=${bucket}&days=${windowDays}&limit=200&offset=0`, { signal: controller.signal }),
    ]).then(([summaryPayload, pagePayload]) => {
      setSummary(summaryPayload)
      setPage(pagePayload)
      setLoadState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState('error')
    })
    return () => controller.abort()
  }, [requestKey, view, windowDays])

  useEffect(() => {
    const update = () => {
      setRecordRoute(readRecordRoute())
      setUnitOpen(null)
      window.scrollTo({ left: 0, top: 0 })
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        window.location.hash = '#/knowledge?search=1'
      }
      if (event.key !== 'Escape') return
      if (unitOpen !== null) {
        setUnitOpen(null)
        return
      }
      if (recordRoute.scoreId !== null || recordRoute.dueUnitId !== null) {
        window.location.hash = '#/verification'
        return
      }
      setFiltersOpen(false)
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [recordRoute.dueUnitId, recordRoute.scoreId, unitOpen])

  useEffect(() => {
    if (unitOpen === null) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [unitOpen])

  useEffect(() => {
    setVisibleLimit(18)
  }, [creator, query, view, windowDays])

  const allItems = useMemo(() => page?.items ?? [], [page])
  const creators = useMemo(() => {
    const counts = new Map<string, number>()
    allItems.forEach((item) => counts.set(item.creator, (counts.get(item.creator) ?? 0) + 1))
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [allItems])
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return allItems.filter((item) => {
      if (creator && item.creator !== creator) return false
      if (!normalized) return true
      return `${item.quote} ${item.creator} ${item.content_title} ${JSON.stringify(item.payload)}`
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [allItems, creator, query])
  const groups = useMemo(() => groupItems(filteredItems), [filteredItems])
  const visibleGroups = groups.slice(0, visibleLimit)
  const datedGroups = useMemo(() => {
    const sections = new Map<string, VerificationGroup[]>()
    visibleGroups.forEach((group) => {
      const key = dateKey(group.primary)
      sections.set(key, [...(sections.get(key) ?? []), group])
    })
    return [...sections.entries()]
  }, [visibleGroups])

  const dueItem = useMemo(() => {
    if (recordRoute.dueUnitId === null) return null
    const match = allItems.find((item) => !isScored(item) && (
      item.unit_id === recordRoute.dueUnitId
      && (!recordRoute.dueHorizon || item.horizon_label === recordRoute.dueHorizon)
    ))
    return match && !isScored(match) ? match : null
  }, [allItems, recordRoute.dueHorizon, recordRoute.dueUnitId])

  const recordItems = allItems
  const recordIndex = recordItems.findIndex((item) => (
    isScored(item)
      ? item.score_id === recordRoute.scoreId
      : item.unit_id === recordRoute.dueUnitId && item.horizon_label === recordRoute.dueHorizon
  ))
  const previousRecord = recordIndex > 0 ? recordItems[recordIndex - 1] : null
  const nextRecord = recordIndex >= 0 && recordIndex < recordItems.length - 1 ? recordItems[recordIndex + 1] : null

  const selectView = (next: QueueView) => {
    setView(next)
    setFiltersOpen(false)
  }

  const openRecord = (item: QueueItem) => {
    window.location.hash = routeFor(item).slice(1)
  }

  const overview = summary?.overview ?? { due: 0, completed: 0, unavailable: 0, review: 0 }
  const overviewItems: Array<{ key: QueueView; count: number; label: string; note: string }> = [
    { key: 'recent', count: overview.completed, label: '最新裁决', note: '已执行' },
    { key: 'due', count: overview.due, label: '待执行', note: `${windowDays} 天内` },
    { key: 'unavailable', count: overview.unavailable, label: '质量异常', note: '不可机械验' },
    { key: 'watch', count: overview.review, label: '观察中', note: '保留语境' },
  ]
  const nearestDue = summary?.nearest_due ?? []

  if (recordRoute.scoreId !== null || recordRoute.dueUnitId !== null) {
    return (
      <div className="verification-page verification-record-page">
        <div aria-hidden="true" className="verification-material" />
        <header className="verification-record-nav">
          <button onClick={() => { window.location.hash = '#/verification' }} type="button">
            <span aria-hidden="true">←</span><b>返回验证日志</b>
          </button>
          <div><span>FANISL / VERIFICATION RECORD</span><b>只读判定档案</b></div>
          <nav aria-label="相邻判定档案">
            <button disabled={!previousRecord} onClick={() => previousRecord && openRecord(previousRecord)} type="button">上一条</button>
            <span>{recordIndex >= 0 ? `${recordIndex + 1} / ${recordItems.length}` : '— / —'}</span>
            <button disabled={!nextRecord} onClick={() => nextRecord && openRecord(nextRecord)} type="button">下一条</button>
          </nav>
        </header>
        <main className="verification-record-stage">
          <VerificationReader
            dueItem={dueItem}
            onCloseUnit={() => setUnitOpen(null)}
            onOpenUnit={setUnitOpen}
            scoreId={recordRoute.scoreId}
            unitOpen={unitOpen}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="verification-page">
      <div aria-hidden="true" className="verification-material" />
      <AppHeader
        current="verification"
        onSearch={() => { window.location.hash = '#/knowledge?search=1' }}
      />

      <main className="verification-stage">
        <header className="verification-masthead">
          <div className="verification-title">
            <span>02 / VERIFICATION LOG</span>
            <h1>验证</h1>
            <p><i />发布时定规则，到期后只看证据</p>
          </div>
          <div className="verification-statement">
            <span>WHAT IT ANSWERS</span>
            <strong>过去的判断，后来发生了什么？</strong>
            <p>这里不是预测榜单，而是知识引擎的质检层。原话、冻结判据、价格窗口和机械裁决共同组成一份不可改写的验证记录。</p>
          </div>
          <div className="verification-overview" aria-label="验证日志分类">
            {overviewItems.map((item) => (
              <button
                aria-pressed={view === item.key}
                key={item.key}
                onClick={() => selectView(item.key)}
                type="button"
              >
                <span>{item.note}</span>
                <strong>{loadState === 'loading' ? '—' : item.count}</strong>
                <b>{item.label}</b>
              </button>
            ))}
          </div>
        </header>

        <section className="verification-due-strip" aria-label="近期执行日程">
          <header><span>NEXT / EXECUTION</span><strong>接下来要验证</strong></header>
          <div>
            {loadState === 'loading' && [0, 1, 2].map((item) => <i key={item} />)}
            {loadState === 'loaded' && nearestDue.length === 0 && <p>未来 {windowDays} 天内没有待执行记录。</p>}
            {nearestDue.map((item) => (
              <button key={itemKey(item)} onClick={() => openRecord(item)} type="button">
                <time>{formatDate(item.horizon_label)}</time>
                <span>{asText(item.payload.asset_symbol) ?? asText(item.payload.asset_text) ?? '未标定标的'}</span>
                <strong>{item.quote}</strong>
                <b aria-hidden="true">↗</b>
              </button>
            ))}
          </div>
        </section>

        <section className="verification-log">
          <header className="verification-log-head">
            <div>
              <span>READ ONLY / CHRONICLE</span>
              <h2>{queueLabels[view]}</h2>
              <p>{queueDescriptions[view]}</p>
            </div>
              <p><b>{loadState === 'loading' ? '—' : page?.total ?? 0}</b><span>个评分时点</span></p>
          </header>

          <div className="verification-tools">
            <label>
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="检索验证日志"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="检索原话、标的或信源"
                ref={searchRef}
                value={query}
              />
              {query && <button aria-label="清空检索" onClick={() => setQuery('')} type="button">×</button>}
            </label>
            <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} type="button">
              <span>信源</span><b>{creator ?? '全部'}</b><i aria-hidden="true">⌄</i>
            </button>
            {view === 'due' && (
              <div className="verification-window" aria-label="待执行观察窗口">
                {[7, 14, 30, 90].map((days) => (
                  <button aria-pressed={windowDays === days} key={days} onClick={() => setWindowDays(days)} type="button">{days}天</button>
                ))}
              </div>
            )}
          </div>

          {filtersOpen && (
            <div className="verification-source-filter">
              <button aria-pressed={creator === null} onClick={() => { setCreator(null); setFiltersOpen(false) }} type="button">
                <span>全部信源</span><b>{allItems.length}</b>
              </button>
              {creators.map(([name, count]) => (
                <button aria-pressed={creator === name} key={name} onClick={() => { setCreator(name); setFiltersOpen(false) }} type="button">
                  <span>{name}</span><b>{count}</b>
                </button>
              ))}
            </div>
          )}

          <div aria-busy={loadState === 'loading'} className="verification-log-body">
            {loadState === 'loading' && [0, 1, 2, 3].map((item) => (
              <div className="verification-log-skeleton" key={item}><i /><span /><span /></div>
            ))}
            {loadState === 'error' && (
              <div className="verification-empty">
                <span>QUEUE UNAVAILABLE</span>
                <strong>验证日志暂时没有载入</strong>
                <p>页面不会用预览数字替代真实裁决。</p>
                <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取</button>
              </div>
            )}
            {loadState === 'loaded' && datedGroups.map(([date, sectionGroups]) => (
              <section className="verification-day" key={date}>
                <header><time>{formatDate(date, true)}</time><span>{sectionGroups.length} 份档案</span></header>
                <div>
                  {sectionGroups.map((group, index) => {
                    const item = group.primary
                    const scored = isScored(item)
                    const asset = asText(item.payload.asset_symbol) ?? asText(item.payload.asset_text)
                    return (
                      <article className={`verification-record-row ${scored ? `outcome-${item.outcome}` : 'outcome-due'}`} key={group.key}>
                        <button className="verification-record-main" onClick={() => openRecord(item)} type="button">
                          <span className="verification-record-number">{String(index + 1).padStart(2, '0')}</span>
                          <span className="verification-record-outcome">
                            <b>{scored ? outcomeMarks[item.outcome] : '↗'}</b>
                            <em>{scored ? outcomeLabels[item.outcome] : '等待执行'}</em>
                          </span>
                          <span className="verification-record-copy">
                            <strong>{item.quote}</strong>
                            <span>{item.creator} · {asset ?? '无规范标的'}</span>
                          </span>
                          <span className="verification-record-result">
                            <small>{scored ? '实测' : '状态'}</small>
                            <b>{scored ? itemSummary(item) : `冻结于 ${formatDate(item.published_at)}`}</b>
                          </span>
                          <span className="verification-record-open">查看档案 <b aria-hidden="true">→</b></span>
                        </button>
                        <footer aria-label="评分时点">
                          <span>评分时点</span>
                          {group.items.map((horizonItem) => (
                            <button
                              aria-label={`打开 ${formatDate(horizonItem.horizon_label, true)} 的${isScored(horizonItem) ? '裁决' : '待执行档案'}`}
                              className={isScored(horizonItem) ? `outcome-${horizonItem.outcome}` : 'outcome-due'}
                              key={itemKey(horizonItem)}
                              onClick={() => openRecord(horizonItem)}
                              type="button"
                            >
                              <i>{isScored(horizonItem) ? outcomeMarks[horizonItem.outcome] : '·'}</i>
                              <time>{formatDate(horizonItem.horizon_label)}</time>
                            </button>
                          ))}
                        </footer>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
            {loadState === 'loaded' && groups.length === 0 && (
              <div className="verification-empty">
                <span>NO RECORD FOUND</span>
                <strong>{query || creator ? '当前条件没有匹配档案' : `${queueLabels[view]}暂时为空`}</strong>
                <p>{query || creator ? '清除检索和信源条件后可恢复完整日志。' : queueDescriptions[view]}</p>
                {(query || creator) && <button onClick={() => { setQuery(''); setCreator(null) }} type="button">清除条件</button>}
              </div>
            )}
          </div>

          {groups.length > visibleGroups.length && (
            <button className="verification-load-more" onClick={() => setVisibleLimit((limit) => limit + 18)} type="button">
              <span>继续读取</span><b>还剩 {groups.length - visibleGroups.length} 份档案</b>
            </button>
          )}
        </section>
      </main>

      <footer className="verification-footer">
        <span>FANISL / VERIFICATION WITHOUT REVISION</span>
        <p>没有事后解释，只有发布时的合同与到期后的证据。</p>
      </footer>
    </div>
  )
}

export default VerificationPage
