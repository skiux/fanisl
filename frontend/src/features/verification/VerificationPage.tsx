import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isVerificationPage } from '../../shared/api/contracts'
import { fetchAllPages } from '../../shared/api/pages'
import { outcomeLabels } from '../../shared/domain/labels'
import AppHeader from '../../shared/navigation/AppHeader'
import { asText, countdown } from '../asset/format'
import EvidenceDossier from '../knowledge/EvidenceDossier'
import RecordDialog from './RecordDialog'
import Timeline from './Timeline'
import {
  QUEUE_VIEWS, RECORD_KINDS, dayLabel, dayOf, defaultStart, indexOfDay, isScored, kindCounts, kindLabels, kindOf,
  matchesQuery, matchesRoute, parseDay, parseRoute, recordKey, routeFor, shortDay, summarizeDays, todayKey,
  type QueueItem, type QueueView, type RecordKind, type RecordRoute,
} from './records'
import './verification.css'

const PAGE_SIZE = 200
// 即将到期不再分 7/14/30/90 天：2026-09-17 实测 90 天与 365 天都是 198 条，一次取完画在时间轴上
const DUE_DAYS = 365
const CARD_GAP = 16
// 卡片的最小高度：放不下一整行就少放一行，剩下的高度由各行平分，卡片区底下不留一截空白
const CARD_MIN_HEIGHT = 168
const CARD_MIN_HEIGHT_NARROW = 132
// 卡片里除原话以外占的高度（上下内边距、标题行、页脚），与 verification.css 对应
const CARD_CHROME = 118
const CARD_CHROME_NARROW = 96

type Bucket = { request: number; items: QueueItem[] | null }

function loadBucket(view: QueueView, signal: AbortSignal) {
  return fetchAllPages<QueueItem>(
    (offset) => `/knowledge/verification-page?bucket=${view}&days=${DUE_DAYS}&limit=${PAGE_SIZE}&offset=${offset}`,
    PAGE_SIZE,
    { signal },
    isVerificationPage,
  )
}

function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function DayCard({ current, item, onMark, onOpen, siblings }: {
  current: boolean
  item: QueueItem
  /** 指到这张卡片时在时间轴上标出它那天，离开时传 null */
  onMark: (day: string | null) => void
  onOpen: (item: QueueItem) => void
  /** 同一条判断的全部评分时点（跨四个分类），按日期排 */
  siblings: QueueItem[]
}) {
  const kind = kindOf(item)
  const symbol = asText(item.payload.asset_symbol)
  return (
    <li>
      <button
        aria-current={current ? 'true' : undefined}
        className={`verify-card kind-${kind}`}
        onBlur={() => onMark(null)}
        onClick={() => onOpen(item)}
        onFocus={() => onMark(dayOf(item))}
        onMouseEnter={() => onMark(dayOf(item))}
        onMouseLeave={() => onMark(null)}
        type="button"
      >
        {/* 方向、价位与条件留给浮层：卡片只回答"谁、说了什么、结果如何" */}
        <span className="verify-card-head">
          <em className="verify-badge">{isScored(item) ? outcomeLabels[item.outcome] : countdown(dayOf(item))}</em>
          <strong>{symbol ?? '—'}</strong>
          <time dateTime={dayOf(item)}>{shortDay(dayOf(item))}</time>
        </span>
        <span className="verify-card-quote">{item.quote}</span>
        <span className="verify-card-foot">
          <small>{item.creator}</small>
          {siblings.length > 1 && (
            <span
              aria-label={`共 ${siblings.length} 个评分时点：${siblings.map((entry) => `${shortDay(dayOf(entry))} ${kindLabels[kindOf(entry)]}`).join('，')}`}
              className="verify-card-ladder"
              role="img"
            >
              {siblings.map((entry) => (
                <i className={`kind-${kindOf(entry)}${recordKey(entry) === recordKey(item) ? ' is-this' : ''}`} key={recordKey(entry)} />
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * 验证页：上面一条判决时间轴是全部记录的缩略图，下面一屏卡片是它的放大镜。
 * 卡片按时间顺序铺满一屏（可以跨好几天），时间轴上用一块高亮标出这一屏覆盖的日期；
 * 翻「更早 / 更晚」时高亮沿轴移动，点轴上某天窗口就移过去。整页不滚动。
 */
function VerificationPage() {
  const [request, setRequest] = useState(0)
  const [buckets, setBuckets] = useState<Partial<Record<QueueView, Bucket>>>({})
  const [route, setRoute] = useState<RecordRoute>(() => parseRoute(window.location.hash))
  const [chosenDay, setChosenDay] = useState<string | null>(() => parseDay(window.location.hash))
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState('')
  const [hidden, setHidden] = useState<Set<RecordKind>>(() => new Set())
  // 窗口停在序列的第几条；key 记下当时的筛选条件，条件一变就回到默认位置
  const [cursor, setCursor] = useState<{ key: string; index: number } | null>(null)
  // 原话能显示几行跟着卡片高度走：卡片高就把原话多露几行，而不是在底下留空
  const [grid, setGrid] = useState({ cols: 3, rows: 2, lines: 3 })
  const [evidenceUnit, setEvidenceUnit] = useState<number | null>(null)
  const [markedDay, setMarkedDay] = useState<string | null>(null)
  const cardsRef = useRef<HTMLOListElement>(null)
  const today = todayKey()

  useEffect(() => {
    const controller = new AbortController()
    QUEUE_VIEWS.forEach((bucket) => {
      loadBucket(bucket, controller.signal)
        .then((items) => setBuckets((current) => ({ ...current, [bucket]: { request, items } })))
        .catch(() => {
          if (!controller.signal.aborted) setBuckets((current) => ({ ...current, [bucket]: { request, items: null } }))
        })
    })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash))
      setChosenDay(parseDay(window.location.hash))
      setCursor(null)
      setEvidenceUnit(null)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  // 卡片区放几列几行由它的实际尺寸定
  useEffect(() => {
    const element = cardsRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const cols = element.clientWidth >= 900 ? 3 : element.clientWidth >= 560 ? 2 : 1
      const minHeight = cols === 1 ? CARD_MIN_HEIGHT_NARROW : CARD_MIN_HEIGHT
      const rows = Math.max(1, Math.floor((element.clientHeight + CARD_GAP) / (minHeight + CARD_GAP)))
      const rowHeight = (element.clientHeight - CARD_GAP * (rows - 1)) / rows
      const lineHeight = cols === 1 ? 15 * 1.65 : 15.5 * 1.75
      const lines = Math.min(8, Math.max(2, Math.floor((rowHeight - (cols === 1 ? CARD_CHROME_NARROW : CARD_CHROME)) / lineHeight)))
      setGrid((current) => (current.cols === cols && current.rows === rows && current.lines === lines ? current : { cols, rows, lines }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bucketState = (bucket: QueueView) => {
    const data = buckets[bucket]
    if (!data || data.request !== request) return 'loading'
    return data.items === null ? 'error' : 'loaded'
  }
  const loading = QUEUE_VIEWS.some((bucket) => bucketState(bucket) === 'loading')
  const failed = QUEUE_VIEWS.filter((bucket) => bucketState(bucket) === 'error')

  const allItems = useMemo(() => QUEUE_VIEWS.flatMap((bucket) => buckets[bucket]?.items ?? []), [buckets])
  const scoped = useMemo(
    () => allItems.filter((item) => (!creator || item.creator === creator) && matchesQuery(item, query)),
    [allItems, creator, query],
  )
  const counts = useMemo(() => kindCounts(scoped), [scoped])
  const days = useMemo(() => summarizeDays(scoped.filter((item) => !hidden.has(kindOf(item)))), [hidden, scoped])
  const scale = useMemo(() => summarizeDays(allItems), [allItems])
  const sequence = useMemo(() => days.flatMap((entry) => entry.items), [days])

  const creators = useMemo(() => {
    const tally = new Map<string, number>()
    allItems.forEach((item) => tally.set(item.creator, (tally.get(item.creator) ?? 0) + 1))
    return [...tally.entries()].sort((left, right) => right[1] - left[1]).map(([name]) => name)
  }, [allItems])

  const range = useMemo(() => {
    const known = allItems.map(dayOf).sort()
    const first = known[0] && known[0] < today ? known[0] : today
    const last = known[known.length - 1] && known[known.length - 1] > today ? known[known.length - 1] : today
    return { start: shiftDay(first, -3), end: shiftDay(last, 4) }
  }, [allItems, today])

  const openItem = route ? allItems.find((item) => matchesRoute(item, route)) ?? null : null
  const openPosition = openItem ? sequence.findIndex((item) => recordKey(item) === recordKey(openItem)) : -1

  const capacity = grid.cols * grid.rows
  const filterKey = `${creator}|${query}|${[...hidden].join(',')}`
  const maxStart = Math.max(0, sequence.length - capacity)
  const base = cursor?.key === filterKey ? cursor.index
    : chosenDay ? indexOfDay(sequence, chosenDay)
      : defaultStart(sequence, today, capacity)
  // 打开的记录必须在窗口里：浮层里逐条往后看，窗口跟着走
  const followed = openPosition < 0 || (openPosition >= base && openPosition < base + capacity) ? base
    : openPosition < base ? openPosition : openPosition - capacity + 1
  const start = Math.min(Math.max(0, followed), maxStart)
  const windowItems = sequence.slice(start, start + capacity)
  const windowFrom = windowItems.length ? dayOf(windowItems[0]) : null
  const windowTo = windowItems.length ? dayOf(windowItems[windowItems.length - 1]) : null
  const windowCounts = kindCounts(windowItems)

  const unitItems = useCallback(
    (unitId: number) => allItems.filter((entry) => entry.unit_id === unitId).sort((left, right) => dayOf(left).localeCompare(dayOf(right))),
    [allItems],
  )

  // 地址只替换不堆历史：刷新或转发仍落在同一段、同一条，返回键直接离开本页
  const setAddress = useCallback((next: { item?: QueueItem; day?: string | null }) => {
    const hash = next.item ? routeFor(next.item) : next.day ? `#/verification?day=${next.day}` : '#/verification'
    window.history.replaceState(window.history.state, '', hash)
    setRoute(parseRoute(hash))
    if (!next.item) setChosenDay(next.day ?? null)
  }, [])

  const moveTo = (index: number) => {
    const clamped = Math.min(Math.max(0, index), maxStart)
    setCursor({ key: filterKey, index: clamped })
    const first = sequence[clamped]
    if (first) setAddress({ day: dayOf(first) })
  }

  const selectDay = (day: string) => moveTo(indexOfDay(sequence, day))
  const stepDay = (delta: number) => {
    const current = windowFrom ? days.findIndex((entry) => entry.day === windowFrom) : -1
    const target = days[current + delta]
    if (target) selectDay(target.day)
  }

  const openRecord = (item: QueueItem) => {
    setCursor({ key: filterKey, index: start })
    setAddress({ item })
  }
  const closeRecord = () => {
    setCursor({ key: filterKey, index: start })
    setAddress({ day: windowFrom })
  }
  const stepRecord = (delta: number) => {
    const target = sequence[openPosition + delta]
    if (target) setAddress({ item: target })
  }

  const toggleKind = (kind: RecordKind) => setHidden((current) => {
    const next = new Set(current)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    return next
  })

  const clearFilters = () => {
    setQuery('')
    setCreator('')
    setHidden(new Set())
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        window.location.hash = '#/knowledge?search=1'
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const filtered = Boolean(query || creator || hidden.size)
  const windowNote = RECORD_KINDS.filter((kind) => windowCounts[kind] > 0).map((kind) => `${kindLabels[kind]} ${windowCounts[kind]}`).join(' · ')

  return (
    <div className="verify-page app-page">
      <AppHeader current="verification" onSearch={() => { window.location.hash = '#/knowledge?search=1' }} />

      <main className="verify-stage">
        <header className="page-head">
          <h1>验证</h1>
          <div aria-label="按类别显示" className="verify-legend" role="group">
            {RECORD_KINDS.map((kind) => (
              <button aria-pressed={!hidden.has(kind)} className={`kind-${kind}`} key={kind} onClick={() => toggleKind(kind)} type="button">
                <i aria-hidden="true" />{kindLabels[kind]}<small>{loading ? '' : counts[kind]}</small>
              </button>
            ))}
          </div>
          <div className="page-head-actions">
            <label className="field-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索验证记录"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
                placeholder="原话、标的或信源"
                type="search"
                value={query}
              />
            </label>
            <select aria-label="信源" className="field-select" onChange={(event) => setCreator(event.target.value)} value={creator}>
              <option value="">全部信源</option>
              {creators.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </header>

        {failed.length > 0 && (
          <p className="verify-notice">
            {failed.map((bucket) => ({ recent: '已判定', due: '即将到期', review: '需复核', unavailable: '不可判' })[bucket]).join('、')}没有读到。
            <button onClick={() => setRequest((value) => value + 1)} type="button">重试</button>
          </p>
        )}
        {route && !loading && !openItem && (
          <p className="verify-notice">
            地址里的这条记录不在当前数据里。
            <button onClick={() => setAddress({ day: windowFrom })} type="button">关闭</button>
          </p>
        )}

        {loading ? (
          <div aria-label="正在读取" className="verify-timeline is-loading" />
        ) : (
          <Timeline
            days={days}
            end={range.end}
            from={windowFrom}
            mark={markedDay}
            onSelect={selectDay}
            onStep={stepDay}
            scale={scale}
            start={range.start}
            to={windowTo}
            today={today}
          />
        )}

        <section aria-label="这一段的判断" className="verify-window">
          <header>
            <h2 aria-live="polite">
              {windowFrom && windowTo ? (windowFrom === windowTo ? dayLabel(windowFrom) : `${shortDay(windowFrom)} – ${shortDay(windowTo)}`) : loading ? '' : '没有记录'}
              {windowNote && <span>{windowNote}</span>}
            </h2>
            {sequence.length > capacity && (
              <nav aria-label="沿时间轴翻看">
                <small>{start + 1}–{start + windowItems.length} / {sequence.length}</small>
                <button className="btn" disabled={start === 0} onClick={() => moveTo(start - capacity)} type="button">‹ 更早</button>
                <button className="btn" disabled={start >= maxStart} onClick={() => moveTo(start + capacity)} type="button">更晚 ›</button>
              </nav>
            )}
          </header>

          <ol className="verify-cards" ref={cardsRef} style={{ '--cols': grid.cols, '--rows': grid.rows, '--quote-lines': grid.lines } as React.CSSProperties}>
            {loading && Array.from({ length: Math.min(capacity, 6) }, (_, index) => <li className="verify-card-skeleton" key={index} />)}
            {!loading && windowItems.map((item) => (
              <DayCard
                current={openItem !== null && recordKey(item) === recordKey(openItem)}
                item={item}
                key={recordKey(item)}
                onMark={setMarkedDay}
                onOpen={openRecord}
                siblings={unitItems(item.unit_id)}
              />
            ))}
            {!loading && sequence.length === 0 && (
              <li className="verify-empty">
                <p>{filtered ? '没有匹配的记录' : '还没有验证记录'}</p>
                {filtered && <button onClick={clearFilters} type="button">清除条件</button>}
              </li>
            )}
          </ol>
        </section>
      </main>

      {openItem && (
        <RecordDialog
          item={openItem}
          onClose={closeRecord}
          onOpenUnit={setEvidenceUnit}
          onSelect={(item) => setAddress({ item })}
          onStep={stepRecord}
          position={openPosition}
          total={sequence.length}
          unitItems={unitItems(openItem.unit_id)}
        />
      )}

      {evidenceUnit !== null && (
        <div className="verify-evidence-overlay">
          <EvidenceDossier
            backLabel="返回验证记录"
            onClose={() => setEvidenceUnit(null)}
            parentLabel="判定"
            parentTitle={openItem && isScored(openItem) ? `#${openItem.score_id}` : openItem?.horizon_label ?? ''}
            unitId={evidenceUnit}
          />
        </div>
      )}
    </div>
  )
}

export default VerificationPage
