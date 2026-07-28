import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import EvidenceDossier from './EvidenceDossier'
import type {
  KnowledgeCreator,
  KnowledgeKind,
  KnowledgeTagSummary,
  KnowledgeUnitSummary,
} from './types'
import './unit-browser.css'

const kindLabels: Record<KnowledgeKind, string> = {
  claim: '判断',
  method: '方法',
  concept: '认知',
}

type KindFilter = 'all' | KnowledgeKind
type SearchState = 'idle' | 'loading' | 'loaded' | 'error'
type TagState = 'loading' | 'loaded' | 'error'

function formatDate(value: string | null | undefined) {
  if (!value) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function UnitBrowser({
  creators,
  filtersOpen,
  focusRequestKey,
  initialUnits,
  isPreview,
  onCloseFilters,
  onCloseReader,
  onOpenFilters,
  onSelectUnit,
  readerOpen,
  selectedUnitId,
}: {
  creators: KnowledgeCreator[]
  filtersOpen: boolean
  focusRequestKey: number
  initialUnits: KnowledgeUnitSummary[]
  isPreview: boolean
  onCloseFilters: () => void
  onCloseReader: () => void
  onOpenFilters: () => void
  onSelectUnit: (unitId: number, openOnMobile?: boolean) => void
  readerOpen: boolean
  selectedUnitId: number | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<KindFilter>('all')
  const [creatorId, setCreatorId] = useState<number | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [scoredOnly, setScoredOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [units, setUnits] = useState<KnowledgeUnitSummary[]>(initialUnits)
  const [tags, setTags] = useState<KnowledgeTagSummary[]>([])
  const [searchState, setSearchState] = useState<SearchState>(initialUnits.length ? 'loaded' : 'idle')
  const [tagState, setTagState] = useState<TagState>('loading')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    if (!focusRequestKey) return
    inputRef.current?.focus()
  }, [focusRequestKey])

  useEffect(() => {
    if (isPreview) {
      setTags([])
      setTagState('error')
      return
    }
    const controller = new AbortController()
    setTagState('loading')
    apiJson<KnowledgeTagSummary[]>('/knowledge/tags', { signal: controller.signal })
      .then((payload) => {
        setTags(payload)
        setTagState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setTagState('error')
      })
    return () => controller.abort()
  }, [isPreview])

  const hasRemoteFilters = kind !== 'all'
    || creatorId !== null
    || tag !== null
    || query.trim().length > 0

  useEffect(() => {
    if (isPreview) {
      setUnits([])
      setSearchState('idle')
      return
    }
    if (!hasRemoteFilters) {
      setUnits(initialUnits)
      setSearchState('loaded')
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: '500' })
      if (kind !== 'all') params.set('kind', kind)
      if (creatorId !== null) params.set('creator', String(creatorId))
      if (tag) params.set('tag', tag)
      if (query.trim()) params.set('q', query.trim())
      setSearchState('loading')

      apiJson<KnowledgeUnitSummary[]>(`/knowledge/units?${params.toString()}`, {
        signal: controller.signal,
      }).then((payload) => {
        setUnits(payload)
        setSearchState('loaded')
      }).catch(() => {
        if (!controller.signal.aborted) setSearchState('error')
      })
    }, query.trim() ? 280 : 0)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [creatorId, hasRemoteFilters, initialUnits, isPreview, kind, query, requestKey, tag])

  const visibleUnits = useMemo(
    () => scoredOnly ? units.filter((unit) => unit.scores.length > 0) : units,
    [scoredOnly, units],
  )
  const selectedUnit = visibleUnits.find((unit) => unit.id === selectedUnitId)
    ?? visibleUnits[0]
    ?? null

  const initialKindCounts = useMemo(() => ({
    all: initialUnits.length,
    claim: initialUnits.filter((unit) => unit.kind === 'claim').length,
    method: initialUnits.filter((unit) => unit.kind === 'method').length,
    concept: initialUnits.filter((unit) => unit.kind === 'concept').length,
  }), [initialUnits])
  const creatorCounts = useMemo(() => {
    const counts = new Map<number, number>()
    initialUnits.forEach((unit) => {
      counts.set(unit.creator_id, (counts.get(unit.creator_id) ?? 0) + 1)
    })
    return counts
  }, [initialUnits])

  const resetFilters = () => {
    setKind('all')
    setCreatorId(null)
    setTag(null)
    setScoredOnly(false)
    setQuery('')
  }

  const handleUnitKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleUnits.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleUnits.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const next = visibleUnits[nextIndex]
    onSelectUnit(next.id)
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-unit-id="${next.id}"]`)?.focus()
    })
  }

  const activeFilterCount = [
    kind !== 'all',
    creatorId !== null,
    tag !== null,
    scoredOnly,
    query.trim().length > 0,
  ].filter(Boolean).length
  const drawerFilterCount = [
    kind !== 'all',
    creatorId !== null,
    tag !== null,
    scoredOnly,
  ].filter(Boolean).length

  return (
    <>
      <aside className="unit-filter-rail" data-open={filtersOpen}>
        <header>
          <span>UNIT / FILTER</span>
          <button onClick={onCloseFilters} type="button">完成</button>
        </header>

        <section>
          <p>单元类型</p>
          {([
            ['all', '全部单元'],
            ['claim', '判断'],
            ['method', '方法'],
            ['concept', '认知'],
          ] as const).map(([value, label]) => (
            <button
              aria-pressed={kind === value}
              key={value}
              onClick={() => setKind(value)}
              type="button"
            >
              <span>{label}</span><b>{initialKindCounts[value]}</b>
            </button>
          ))}
        </section>

        <section>
          <p>信源</p>
          <button aria-pressed={creatorId === null} onClick={() => setCreatorId(null)} type="button">
            <span>全部信源</span><b>{creators.length}</b>
          </button>
          {creators.map((creator) => (
            <button
              aria-pressed={creatorId === creator.id}
              key={creator.id}
              onClick={() => setCreatorId(creator.id)}
              type="button"
            >
              <span>{creator.name}</span><b>{creatorCounts.get(creator.id) ?? 0}</b>
            </button>
          ))}
        </section>

        <section className="unit-tag-section">
          <p>标签枢纽</p>
          {tagState === 'loading' && <div className="unit-tags-loading"><i /><i /><i /></div>}
          {tagState === 'error' && <span className="unit-tags-error">标签统计暂时不可用</span>}
          {tagState === 'loaded' && tags.slice(0, 14).map((item) => (
            <button
              aria-label={`${item.tag}，${item.n} 个单元，其中判断 ${item.n_claims}、方法 ${item.n_methods}、认知 ${item.n_concepts}`}
              aria-pressed={tag === item.tag}
              key={item.tag}
              onClick={() => setTag(tag === item.tag ? null : item.tag)}
              type="button"
            >
              <span>{item.tag}</span>
              <b>{item.n}</b>
              <em aria-hidden="true">
                <i style={{ flex: item.n_claims || 0.001 }} />
                <i style={{ flex: item.n_methods || 0.001 }} />
                <i style={{ flex: item.n_concepts || 0.001 }} />
              </em>
            </button>
          ))}
        </section>

        <label className="unit-scored-toggle">
          <input
            checked={scoredOnly}
            onChange={(event) => setScoredOnly(event.target.checked)}
            type="checkbox"
          />
          <span><i /></span>
          <b>只看已有市场裁决</b>
        </label>

        <footer>
          <span>{activeFilterCount ? `${activeFilterCount} 个条件` : '全库范围'}</span>
          {activeFilterCount ? <button onClick={resetFilters} type="button">清除</button> : <b>L1 EVIDENCE</b>}
        </footer>
      </aside>

      <section className="unit-catalog">
        <header>
          <button
            aria-expanded={filtersOpen}
            className="unit-mobile-filter"
            onClick={onOpenFilters}
            type="button"
          >
            筛选{drawerFilterCount ? ` · ${drawerFilterCount}` : ''}
          </button>
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="全文检索知识单元"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                setQuery('')
                inputRef.current?.blur()
              }}
              placeholder="检索逐字引文与结构字段"
              ref={inputRef}
              value={query}
            />
            {query && <button aria-label="清空单元检索" onClick={() => setQuery('')} type="button">×</button>}
            <kbd>⌘K</kbd>
          </label>
        </header>

        <div className="unit-catalog-state">
          <p aria-live="polite">
            <strong>{visibleUnits.length}</strong><span>个单元</span>
          </p>
          <span>{query.trim() ? '匹配引文与结构字段' : tag ? `标签 / ${tag}` : '按发布时间倒序'}</span>
        </div>

        {isPreview && (
          <div className="unit-preview-notice">后端未连接，单元全文检索需要真实知识接口。</div>
        )}

        <div className="unit-list" aria-busy={searchState === 'loading'}>
          {searchState === 'loading' && [0, 1, 2, 3].map((item) => (
            <div className="unit-row unit-row-skeleton" key={item}><i /><span /><span /></div>
          ))}

          {searchState === 'error' && (
            <div className="unit-search-error">
              <span>SEARCH UNAVAILABLE</span>
              <strong>单元检索暂时不可用</strong>
              <p>筛选条件已保留，重试不会清空当前检索词。</p>
              <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新检索</button>
            </div>
          )}

          {searchState !== 'loading' && searchState !== 'error' && visibleUnits.map((unit, index) => (
            <button
              aria-pressed={selectedUnit?.id === unit.id}
              className={`unit-row kind-${unit.kind}`}
              data-unit-id={unit.id}
              key={unit.id}
              onClick={() => onSelectUnit(unit.id, true)}
              onKeyDown={(event) => handleUnitKeyDown(event, index)}
              type="button"
            >
              <span className="unit-row-number">{String(index + 1).padStart(3, '0')}</span>
              <span className="unit-row-body">
                <span className="unit-row-meta">
                  <b>{kindLabels[unit.kind]}</b>
                  <i />
                  <em>{unit.creator}</em>
                  <time>{formatDate(unit.published_at)}</time>
                </span>
                <strong>{unit.quote}</strong>
                <span className="unit-row-source">{unit.content_title}</span>
                <span className="unit-row-foot">
                  {unit.tags.slice(0, 3).map((item) => <em key={item}>{item}</em>)}
                  <b>
                    {unit.kind === 'claim'
                      ? unit.scores.length
                        ? `${unit.scores.length} 个裁决`
                        : '等待裁决'
                      : '不直接计分'}
                  </b>
                </span>
              </span>
            </button>
          ))}

          {searchState !== 'loading' && searchState !== 'error' && visibleUnits.length === 0 && (
            <div className="unit-list-empty">
              <span>NO MATCHED UNIT</span>
              <strong>没有匹配的知识单元</strong>
              <p>当前条件会同时作用于逐字引文和结构字段。</p>
              <button onClick={resetFilters} type="button">清除全部条件</button>
            </div>
          )}
        </div>
      </section>

      <aside className="unit-reader" data-open={readerOpen}>
        <button className="unit-reader-close" onClick={onCloseReader} type="button">
          <span>返回单元索引</span><b>×</b>
        </button>
        {selectedUnit && (
          <EvidenceDossier
            embedded
            onClose={onCloseReader}
            parentLabel="UNIT"
            parentTitle={selectedUnit.quote}
            unitId={selectedUnit.id}
          />
        )}
      </aside>
    </>
  )
}

export default UnitBrowser
