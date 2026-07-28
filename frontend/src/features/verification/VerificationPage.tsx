import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import { VerificationReader } from './VerificationDossier'
import type {
  DueVerification,
  ScoredVerification,
  VerificationOutcome,
  VerificationQueue,
} from './types'
import './verification.css'

type QueueView = 'recent' | 'due' | 'review' | 'unavailable'
type QueueItem = DueVerification | ScoredVerification
type LoadState = 'loading' | 'loaded' | 'error'

const queueLabels: Record<QueueView, string> = {
  recent: '近期判定',
  due: '即将到期',
  review: '需要复核',
  unavailable: '不可判定',
}

const queueDescriptions: Record<QueueView, string> = {
  recent: '已由评分器机械执行的命中、部分命中与未命中。',
  due: '未来窗口内将到期、且尚未写入评分的冻结时点。',
  review: '条件未触发或仍为 pending，需要保留上下文继续观察。',
  unavailable: '无法取价或条件不可机械验证，空白本身也是质量信号。',
}

const outcomeLabels: Record<VerificationOutcome, string> = {
  hit: '命中',
  partial: '部分',
  miss: '未中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '等待复核',
}

function isScored(item: QueueItem): item is ScoredVerification {
  return 'score_id' in item
}

function itemKey(item: QueueItem) {
  return isScored(item)
    ? `score-${item.score_id}`
    : `due-${item.unit_id}-${item.horizon_label}`
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
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

function VerificationPage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const readerBodyRef = useRef<HTMLDivElement>(null)
  const [queue, setQueue] = useState<VerificationQueue | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [windowDays, setWindowDays] = useState(14)
  const [view, setView] = useState<QueueView>('recent')
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
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
        window.location.hash = '#/knowledge?search=1'
      }
      if (event.key !== 'Escape') return
      if (unitOpen !== null) {
        setUnitOpen(null)
        return
      }
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
      setFiltersOpen(false)
      setReaderOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [unitOpen])

  useEffect(() => {
    const isNarrow = window.matchMedia('(max-width: 900px)').matches
    if (!isNarrow || (!filtersOpen && !readerOpen)) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [filtersOpen, readerOpen])

  const allItems = useMemo(() => queue
    ? [...queue.recent, ...queue.due, ...queue.review, ...queue.unavailable]
    : [], [queue])
  const creators = useMemo(() => {
    const counts = new Map<string, number>()
    allItems.forEach((item) => counts.set(item.creator, (counts.get(item.creator) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [allItems])
  const viewItems = useMemo(() => queue?.[view] ?? [], [queue, view])
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return viewItems.filter((item) => {
      if (creator && item.creator !== creator) return false
      if (!normalized) return true
      const payloadText = JSON.stringify(item.payload)
      return `${item.quote} ${item.creator} ${item.content_title} ${payloadText}`
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [creator, query, viewItems])
  const selectedItem = visibleItems.find((item) => itemKey(item) === selectedKey)
    ?? visibleItems[0]
    ?? null
  const selectedPosition = selectedItem
    ? visibleItems.findIndex((item) => itemKey(item) === itemKey(selectedItem)) + 1
    : 0
  const selectedItemKey = selectedItem ? itemKey(selectedItem) : null

  useEffect(() => {
    readerBodyRef.current?.scrollTo({ top: 0 })
  }, [selectedItemKey])

  const selectView = (next: QueueView) => {
    setView(next)
    setSelectedKey(null)
    setReaderOpen(false)
    setUnitOpen(null)
  }

  const selectItem = (item: QueueItem, openOnMobile = false) => {
    setSelectedKey(itemKey(item))
    setUnitOpen(null)
    if (openOnMobile) setReaderOpen(true)
  }

  const handleRowKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleItems.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleItems.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const next = visibleItems[nextIndex]
    setSelectedKey(itemKey(next))
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-verification-key="${itemKey(next)}"]`)?.focus()
    })
  }

  const clearFilters = () => {
    setQuery('')
    setCreator(null)
  }

  const overview = queue?.overview ?? { due: 0, completed: 0, unavailable: 0, review: 0 }
  const overviewItems: Array<{ key: QueueView; count: number; label: string; meta: string }> = [
    { key: 'due', count: overview.due, label: '即将到期', meta: `${windowDays} 天窗口` },
    { key: 'recent', count: overview.completed, label: '近期判定', meta: '机械裁决' },
    { key: 'unavailable', count: overview.unavailable, label: '不可判定', meta: '质量信号' },
    { key: 'review', count: overview.review, label: '需要复核', meta: '保留语境' },
  ]

  return (
    <div className="verification-page">
      <div aria-hidden="true" className="verification-material" />
      <AppHeader
        current="verification"
        onSearch={() => {
          window.location.hash = '#/knowledge?search=1'
        }}
      />

      <main className="verification-stage">
        <header className="verification-masthead">
          <div className="verification-title">
            <span>02 / VERIFICATION CENTER</span>
            <h1>验证</h1>
            <p><i />L2 · 机械质检层</p>
          </div>
          <div className="verification-statement">
            <strong>验证不是预测竞赛，<br />而是给知识留下可信的质检戳。</strong>
            <p>判据在发布时冻结；到期只读价格、执行规则、保留结果。</p>
          </div>
          <div className="verification-overview" aria-label="验证行动概览">
            {overviewItems.map((item) => (
              <button
                aria-pressed={view === item.key}
                className={`overview-${item.key}`}
                key={item.key}
                onClick={() => selectView(item.key)}
                type="button"
              >
                <span>{item.meta}</span>
                <strong>{loadState === 'loading' ? '—' : item.count}</strong>
                <b>{item.label}</b>
              </button>
            ))}
          </div>
        </header>

        <section className="verification-frame">
          <button
            aria-label="关闭当前面板"
            className="verification-backdrop"
            data-open={filtersOpen || readerOpen}
            onClick={() => {
              setFiltersOpen(false)
              setReaderOpen(false)
              setUnitOpen(null)
            }}
            type="button"
          />

          <aside className="verification-rail" data-open={filtersOpen}>
            <header><span>QUEUE / FILTER</span><button onClick={() => setFiltersOpen(false)} type="button">完成</button></header>
            <section>
              <p>行动队列</p>
              {overviewItems.map((item) => (
                <button
                  aria-pressed={view === item.key}
                  key={item.key}
                  onClick={() => selectView(item.key)}
                  type="button"
                >
                  <span>{item.label}</span><b>{item.count}</b>
                </button>
              ))}
            </section>
            <section>
              <p>到期观察窗口</p>
              <div className="verification-window">
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
              <span className="window-note">只改变“即将到期”的未来范围。</span>
            </section>
            <section>
              <p>信源</p>
              <button aria-pressed={creator === null} onClick={() => setCreator(null)} type="button">
                <span>全部信源</span><b>{allItems.length}</b>
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
            </section>
            <footer>
              <span><i />判据冻结</span>
              {(query || creator) ? <button onClick={clearFilters} type="button">清除条件</button> : <b>READ ONLY</b>}
            </footer>
          </aside>

          <section className="verification-catalog">
            <header>
              <button
                aria-expanded={filtersOpen}
                className="verification-filter-trigger"
                onClick={() => setFiltersOpen(true)}
                type="button"
              >
                筛选{creator ? ' · 1' : ''}
              </button>
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="检索验证队列"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    setQuery('')
                    searchRef.current?.blur()
                  }}
                  placeholder="检索判断、标的、信源或内容"
                  ref={searchRef}
                  value={query}
                />
                {query && <button aria-label="清空验证检索" onClick={() => setQuery('')} type="button">×</button>}
              </label>
            </header>

            <div className="verification-catalog-state">
              <div><strong>{queueLabels[view]}</strong><span>{queueDescriptions[view]}</span></div>
              <p><b>{loadState === 'loading' ? '—' : visibleItems.length}</b><span>条</span></p>
            </div>

            <div className="verification-list" aria-busy={loadState === 'loading'}>
              {loadState === 'loading' && [0, 1, 2, 3].map((item) => (
                <div className="verification-row verification-row-skeleton" key={item}><i /><span /><span /></div>
              ))}
              {loadState === 'error' && (
                <div className="verification-list-error">
                  <span>QUEUE UNAVAILABLE</span>
                  <strong>验证队列暂时没有载入</strong>
                  <p>页面不会用预览数字代替真实裁决。</p>
                  <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取队列</button>
                </div>
              )}
              {loadState === 'loaded' && visibleItems.map((item, index) => {
                const scored = isScored(item)
                const asset = asText(item.payload.asset_symbol) ?? asText(item.payload.asset_text)
                return (
                  <button
                    aria-pressed={selectedItem ? itemKey(selectedItem) === itemKey(item) : false}
                    className={`verification-row ${scored ? `outcome-${item.outcome}` : 'outcome-due'}`}
                    data-verification-key={itemKey(item)}
                    key={itemKey(item)}
                    onClick={() => selectItem(item, true)}
                    onFocus={() => selectItem(item)}
                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                    type="button"
                  >
                    <span className="verification-row-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="verification-row-body">
                      <span className="verification-row-meta">
                        <b>{scored ? outcomeLabels[item.outcome] : '等待到期'}</b>
                        <i />
                        <em>{item.creator}</em>
                        <time>{scored ? formatDate(item.scored_at, true) : item.horizon_label}</time>
                      </span>
                      <strong>{item.quote}</strong>
                      <span className="verification-row-source">{item.content_title}</span>
                      <span className="verification-row-foot">
                        <em>{asset ?? '无规范标的'}</em>
                        <b>{scored ? itemSummary(item) : `冻结于 ${formatDate(item.published_at)}`}</b>
                      </span>
                    </span>
                  </button>
                )
              })}
              {loadState === 'loaded' && visibleItems.length === 0 && (
                <div className="verification-empty">
                  <span>NO ACTION IN QUEUE</span>
                  <strong>{query || creator ? '当前条件没有匹配记录' : `${queueLabels[view]}队列为空`}</strong>
                  <p>{query || creator ? '清除检索或信源条件即可恢复当前队列。' : queueDescriptions[view]}</p>
                  {(query || creator) && <button onClick={clearFilters} type="button">清除全部条件</button>}
                </div>
              )}
            </div>
          </section>

          <aside className="verification-reader" data-open={readerOpen}>
            <button
              className="verification-reader-close"
              onClick={() => {
                setReaderOpen(false)
                setUnitOpen(null)
              }}
              type="button"
            >
              <span>返回行动队列</span><b>×</b>
            </button>
            {selectedItem && (
              <>
                <div className="verification-reader-index">
                  <span>{queueLabels[view].toUpperCase()}</span>
                  <p><b>{String(selectedPosition).padStart(2, '0')}</b> / {String(visibleItems.length).padStart(2, '0')}</p>
                </div>
                <div className="verification-reader-body" ref={readerBodyRef}>
                  <VerificationReader
                    dueHorizon={isScored(selectedItem) ? null : selectedItem.horizon_label}
                    dueUnitId={isScored(selectedItem) ? null : selectedItem.unit_id}
                    onCloseUnit={() => setUnitOpen(null)}
                    onOpenUnit={setUnitOpen}
                    scoreId={isScored(selectedItem) ? selectedItem.score_id : null}
                    unitOpen={unitOpen}
                  />
                </div>
              </>
            )}
            {!selectedItem && loadState === 'loaded' && (
              <div className="verification-reader-empty"><span>L2</span><p>选择一条行动记录查看冻结判据与市场证据。</p></div>
            )}
          </aside>
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
