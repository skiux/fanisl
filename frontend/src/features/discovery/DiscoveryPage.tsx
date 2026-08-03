import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import {
  ConsensusDossier,
  HarnessDossier,
  RelationDossier,
  WeeklyDossier,
} from './DiscoveryDossier'
import type {
  DiscoveryConsensusNode,
  DiscoveryRelation,
  DiscoveryRelationKind,
  HarnessCandidate,
  SpotCheckStats,
  WeeklyReport,
} from './types'
import './discovery.css'

type DiscoveryView = 'relations' | 'consensus' | 'harness' | 'weekly'
type RelationFilter = 'all' | DiscoveryRelationKind
type LoadState = 'loading' | 'loaded' | 'error'

const viewLabels: Record<DiscoveryView, string> = {
  relations: '关系图谱',
  consensus: '跨源共识',
  harness: '研究候选',
  weekly: '每周增量',
}

const viewDescriptions: Record<DiscoveryView, string> = {
  relations: '逐条阅读不能同时成立的命题，以及必须合读的互补知识。',
  consensus: '同一命题被多个独立信源重复表达；共识由提及形成，不另造关系边。',
  harness: '从可回测方法中筛出的研究入口；候选不等于立项，更不等于结论。',
  weekly: '只看窗口内新增的内容、裁决、关系与运营缺口。',
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase()
}

function relationLabel(relation: DiscoveryRelationKind) {
  return relation === 'conflicts' ? '对立' : '关联'
}

function rowKeyboardNavigation<T>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
  rows: T[],
  select: (row: T) => void,
  selector: (row: T) => string,
) {
  let nextIndex: number | null = null
  if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, rows.length - 1)
  if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = rows.length - 1
  if (nextIndex === null || nextIndex === index) return
  event.preventDefault()
  const next = rows[nextIndex]
  select(next)
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-discovery-key="${selector(next)}"]`)?.focus()
  })
}

function DiscoveryPage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const detailBodyRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<DiscoveryView>('relations')
  const [query, setQuery] = useState('')
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all')
  const [railOpen, setRailOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)

  const [relations, setRelations] = useState<DiscoveryRelation[]>([])
  const [relationState, setRelationState] = useState<LoadState>('loading')
  const [relationRequestKey, setRelationRequestKey] = useState(0)
  const [selectedRelationId, setSelectedRelationId] = useState<number | null>(null)

  const [consensus, setConsensus] = useState<DiscoveryConsensusNode[]>([])
  const [consensusState, setConsensusState] = useState<LoadState>('loading')
  const [consensusRequestKey, setConsensusRequestKey] = useState(0)
  const [selectedConsensusId, setSelectedConsensusId] = useState<number | null>(null)

  const [candidates, setCandidates] = useState<HarnessCandidate[]>([])
  const [candidateState, setCandidateState] = useState<LoadState>('loading')
  const [candidateRequestKey, setCandidateRequestKey] = useState(0)
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)

  const [spotChecks, setSpotChecks] = useState<SpotCheckStats | null>(null)
  const [spotState, setSpotState] = useState<LoadState>('loading')
  const [spotRequestKey, setSpotRequestKey] = useState(0)

  const [weekDays, setWeekDays] = useState(7)
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null)
  const [weeklyState, setWeeklyState] = useState<LoadState>('loading')
  const [weeklyRequestKey, setWeeklyRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setRelationState('loading')
    apiJson<DiscoveryRelation[]>('/knowledge/relations', { signal: controller.signal })
      .then((rows) => {
        setRelations(rows)
        setSelectedRelationId((current) => current ?? rows.find((row) => row.relation === 'conflicts')?.id ?? rows[0]?.id ?? null)
        setRelationState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setRelationState('error')
      })
    return () => controller.abort()
  }, [relationRequestKey])

  useEffect(() => {
    const controller = new AbortController()
    setConsensusState('loading')
    apiJson<DiscoveryConsensusNode[]>('/knowledge/nodes?cross_source=true&limit=100', {
      signal: controller.signal,
    }).then((rows) => {
      setConsensus(rows)
      setSelectedConsensusId((current) => current ?? rows[0]?.id ?? null)
      setConsensusState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setConsensusState('error')
    })
    return () => controller.abort()
  }, [consensusRequestKey])

  useEffect(() => {
    const controller = new AbortController()
    setCandidateState('loading')
    apiJson<HarnessCandidate[]>('/knowledge/harness-candidates', {
      signal: controller.signal,
    }).then((rows) => {
      setCandidates(rows)
      setSelectedCandidateId((current) => current ?? rows[0]?.node_id ?? null)
      setCandidateState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setCandidateState('error')
    })
    return () => controller.abort()
  }, [candidateRequestKey])

  useEffect(() => {
    const controller = new AbortController()
    setSpotState('loading')
    apiJson<SpotCheckStats>('/knowledge/spot-checks', { signal: controller.signal })
      .then((payload) => {
        setSpotChecks(payload)
        setSpotState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setSpotState('error')
      })
    return () => controller.abort()
  }, [spotRequestKey])

  useEffect(() => {
    if (view !== 'weekly') return
    const controller = new AbortController()
    setWeekly(null)
    setWeeklyState('loading')
    apiJson<WeeklyReport>(`/knowledge/weekly?days=${weekDays}`, {
      signal: controller.signal,
    }).then((payload) => {
      setWeekly(payload)
      setWeeklyState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setWeeklyState('error')
    })
    return () => controller.abort()
  }, [view, weekDays, weeklyRequestKey])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        window.location.hash = '#/knowledge?search=1'
        return
      }
      if (event.key !== 'Escape') return
      if (evidenceUnitId !== null) {
        setEvidenceUnitId(null)
        return
      }
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
        return
      }
      setDetailOpen(false)
      setRailOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [evidenceUnitId])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 900px)').matches
    if (!narrow || (!railOpen && !detailOpen)) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [detailOpen, railOpen])

  const conflicts = relations.filter((row) => row.relation === 'conflicts')
  const related = relations.filter((row) => row.relation === 'relates')
  const filterText = normalized(query)

  const visibleRelations = useMemo(() => relations.filter((row) => {
    if (relationFilter !== 'all' && row.relation !== relationFilter) return false
    if (!filterText) return true
    return `${row.a_title} ${row.b_title} ${row.note}`.toLocaleLowerCase().includes(filterText)
  }), [filterText, relationFilter, relations])

  const visibleConsensus = useMemo(() => consensus.filter((node) => {
    if (!filterText) return true
    return `${node.title} ${node.canonical} ${node.notes ?? ''} ${node.tags.join(' ')}`
      .toLocaleLowerCase()
      .includes(filterText)
  }), [consensus, filterText])

  const visibleCandidates = useMemo(() => candidates.filter((candidate) => {
    if (!filterText) return true
    return `${candidate.title} ${candidate.canonical} ${JSON.stringify(candidate.payload)}`
      .toLocaleLowerCase()
      .includes(filterText)
  }), [candidates, filterText])

  const selectedRelation = visibleRelations.find((row) => row.id === selectedRelationId)
    ?? visibleRelations[0]
    ?? null
  const selectedConsensus = visibleConsensus.find((row) => row.id === selectedConsensusId)
    ?? visibleConsensus[0]
    ?? null
  const selectedCandidate = visibleCandidates.find((row) => row.node_id === selectedCandidateId)
    ?? visibleCandidates[0]
    ?? null

  const activeDetailKey = view === 'relations'
    ? selectedRelation?.id
    : view === 'consensus'
      ? selectedConsensus?.id
      : view === 'harness'
        ? selectedCandidate?.node_id
        : `${weekDays}-${weekly?.generated_at ?? ''}`

  useEffect(() => {
    detailBodyRef.current?.scrollTo({ top: 0 })
  }, [activeDetailKey])

  const selectView = (next: DiscoveryView) => {
    setView(next)
    setQuery('')
    setEvidenceUnitId(null)
    setDetailOpen(false)
    setRailOpen(false)
  }

  const openOnMobile = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setDetailOpen(true)
  }

  const viewCount = view === 'relations'
    ? visibleRelations.length
    : view === 'consensus'
      ? visibleConsensus.length
      : view === 'harness'
        ? visibleCandidates.length
        : weeklyState === 'loaded' ? 1 : 0

  const currentState = view === 'relations'
    ? relationState
    : view === 'consensus'
      ? consensusState
      : view === 'harness'
        ? candidateState
        : weeklyState

  const retryCurrent = () => {
    if (view === 'relations') setRelationRequestKey((value) => value + 1)
    if (view === 'consensus') setConsensusRequestKey((value) => value + 1)
    if (view === 'harness') setCandidateRequestKey((value) => value + 1)
    if (view === 'weekly') setWeeklyRequestKey((value) => value + 1)
  }

  return (
    <div className="discovery-page">
      <div aria-hidden="true" className="discovery-material" />
      <AppHeader
        current="discovery"
        onSearch={() => {
          window.location.hash = '#/knowledge?search=1'
        }}
      />

      <main className="discovery-stage">
        <header className="discovery-masthead">
          <div className="discovery-title">
            <span>03 / DISCOVERY FIELD</span>
            <h1>发现</h1>
            <p><i />关系、共识与研究入口</p>
          </div>
          <div className="discovery-statement">
            <strong>把孤立的知识，<br />放回它的关系里。</strong>
            <p>这里不生产结论；这里只暴露分歧、互补证据，以及值得进入研究流程的方法。</p>
          </div>
          <div aria-label="发现域规模" className="discovery-ledger">
            <span><strong>{relationState === 'loading' ? '—' : conflicts.length}</strong><small>对立命题</small></span>
            <span><strong>{relationState === 'loading' ? '—' : related.length}</strong><small>互补关系</small></span>
            <span><strong>{consensusState === 'loading' ? '—' : consensus.length}</strong><small>跨源共识</small></span>
            <span><strong>{candidateState === 'loading' ? '—' : candidates.length}</strong><small>研究候选</small></span>
          </div>
        </header>

        <section className={`discovery-workbench discovery-view-${view}`}>
          <button
            aria-label="关闭当前面板"
            className="discovery-backdrop"
            data-open={railOpen || detailOpen}
            onClick={() => {
              setRailOpen(false)
              setDetailOpen(false)
              setEvidenceUnitId(null)
            }}
            type="button"
          />

          <aside className="discovery-rail" data-open={railOpen}>
            <header><span>DISCOVERY / INDEX</span><button onClick={() => setRailOpen(false)} type="button">完成</button></header>
            <nav aria-label="发现页视图">
              {(Object.keys(viewLabels) as DiscoveryView[]).map((item) => {
                const count = item === 'relations'
                  ? relations.length
                  : item === 'consensus'
                    ? consensus.length
                    : item === 'harness'
                      ? candidates.length
                      : null
                return (
                  <button aria-pressed={view === item} key={item} onClick={() => selectView(item)} type="button">
                    <span>{viewLabels[item]}</span>{count !== null && <b>{count}</b>}
                  </button>
                )
              })}
            </nav>
            <section className="discovery-rail-principle">
              <span>阅读原则</span>
              <p>关系理由是正文。命题必须回到节点、提及和逐字原文。</p>
            </section>
            <section className="discovery-rail-quality">
              <span>人工抽查</span>
              {spotState === 'loading' && <strong>读取中</strong>}
              {spotState === 'error' && <button onClick={() => setSpotRequestKey((value) => value + 1)} type="button">重新读取</button>}
              {spotState === 'loaded' && spotChecks && (
                <>
                  <strong>{spotChecks.checked} / {spotChecks.total}</strong>
                  <p>{spotChecks.checked === 0 ? '尚未执行每周人工抽样。' : `${((spotChecks.checked / Math.max(1, spotChecks.total)) * 100).toFixed(1)}% 覆盖`}</p>
                </>
              )}
            </section>
            <footer><span><i />只读发现层</span><b>NO SYNTHETIC DATA</b></footer>
          </aside>

          <section className="discovery-canvas">
            <header className="discovery-canvas-head">
              <button
                aria-expanded={railOpen}
                className="discovery-filter-trigger"
                onClick={() => setRailOpen(true)}
                type="button"
              >
                视图 · {viewLabels[view]}
              </button>
              <div>
                <strong>{viewLabels[view]}</strong>
                <span>{viewDescriptions[view]}</span>
              </div>
              <p><b>{currentState === 'loading' ? '—' : viewCount}</b><span>{view === 'weekly' ? '期' : '项'}</span></p>
            </header>

            {view !== 'weekly' && (
              <div className="discovery-querybar">
                {view === 'relations' && (
                  <div className="relation-filter" aria-label="关系类型">
                    {([
                      ['all', '全部'],
                      ['conflicts', '对立'],
                      ['relates', '关联'],
                    ] as Array<[RelationFilter, string]>).map(([key, label]) => (
                      <button
                        aria-pressed={relationFilter === key}
                        key={key}
                        onClick={() => {
                          setRelationFilter(key)
                          setSelectedRelationId(null)
                        }}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <label>
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label={`检索${viewLabels[view]}`}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={view === 'relations' ? '检索命题与关系理由' : view === 'consensus' ? '检索共识节点' : '检索方法、规则或数据需求'}
                    ref={searchRef}
                    value={query}
                  />
                  {query && <button aria-label="清空发现检索" onClick={() => setQuery('')} type="button">×</button>}
                </label>
              </div>
            )}

            {view === 'weekly' && (
              <div className="weekly-window" aria-label="周报观察窗口">
                <span>观察窗口</span>
                {[7, 14, 30].map((days) => (
                  <button aria-pressed={weekDays === days} key={days} onClick={() => setWeekDays(days)} type="button">{days} 天</button>
                ))}
                <b>生成时只读取知识增量</b>
              </div>
            )}

            {currentState === 'loading' && (
              <div aria-label={`正在读取${viewLabels[view]}`} className="discovery-view-loading">
                <span /><i /><i /><b />
              </div>
            )}

            {currentState === 'error' && (
              <div className="discovery-view-error">
                <span>DISCOVERY SOURCE UNAVAILABLE</span>
                <strong>{viewLabels[view]}暂时没有载入</strong>
                <p>页面不会用样板关系或预览数字替代真实知识。</p>
                <button onClick={retryCurrent} type="button">重新读取</button>
              </div>
            )}

            {currentState === 'loaded' && view === 'relations' && (
              <div className="discovery-split">
                <div className="discovery-list relation-list" aria-label="关系边">
                  {visibleRelations.map((relation, index) => (
                    <button
                      aria-pressed={selectedRelation?.id === relation.id}
                      className={`discovery-index-row relation-${relation.relation}`}
                      data-discovery-key={`relation-${relation.id}`}
                      key={relation.id}
                      onClick={() => {
                        setSelectedRelationId(relation.id)
                        setEvidenceUnitId(null)
                        openOnMobile()
                      }}
                      onFocus={() => setSelectedRelationId(relation.id)}
                      onKeyDown={(event) => rowKeyboardNavigation(
                        event,
                        index,
                        visibleRelations,
                        (row) => setSelectedRelationId(row.id),
                        (row) => `relation-${row.id}`,
                      )}
                      type="button"
                    >
                      <span className="discovery-index-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <b>{relationLabel(relation.relation)}</b>
                        <strong>{relation.a_title}</strong>
                        <i>{relation.relation === 'conflicts' ? 'VS' : '＋'}</i>
                        <strong>{relation.b_title}</strong>
                      </span>
                    </button>
                  ))}
                  {visibleRelations.length === 0 && (
                    <div className="discovery-list-empty"><span>NO RELATION</span><strong>没有匹配的关系边</strong><button onClick={() => setQuery('')} type="button">清除检索</button></div>
                  )}
                </div>
                <div className="discovery-detail" data-open={detailOpen}>
                  <button className="discovery-detail-close" onClick={() => setDetailOpen(false)} type="button"><span>返回关系索引</span><b>×</b></button>
                  <div className="discovery-detail-body" ref={detailBodyRef}>
                    {selectedRelation && (
                      <RelationDossier
                        evidenceUnitId={evidenceUnitId}
                        onCloseEvidence={() => setEvidenceUnitId(null)}
                        onOpenEvidence={setEvidenceUnitId}
                        relation={selectedRelation}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {currentState === 'loaded' && view === 'consensus' && (
              <div className="discovery-split">
                <div className="discovery-list consensus-list" aria-label="跨源共识节点">
                  {visibleConsensus.map((node, index) => (
                    <button
                      aria-pressed={selectedConsensus?.id === node.id}
                      className="discovery-index-row"
                      data-discovery-key={`consensus-${node.id}`}
                      key={node.id}
                      onClick={() => {
                        setSelectedConsensusId(node.id)
                        setEvidenceUnitId(null)
                        openOnMobile()
                      }}
                      onFocus={() => setSelectedConsensusId(node.id)}
                      onKeyDown={(event) => rowKeyboardNavigation(
                        event,
                        index,
                        visibleConsensus,
                        (row) => setSelectedConsensusId(row.id),
                        (row) => `consensus-${row.id}`,
                      )}
                      type="button"
                    >
                      <span className="discovery-index-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <b>{node.n_creators} 个信源 · {node.n_attest} 条提及</b>
                        <strong>{node.title}</strong>
                        <p>{node.canonical}</p>
                      </span>
                    </button>
                  ))}
                  {visibleConsensus.length === 0 && (
                    <div className="discovery-list-empty"><span>NO CONSENSUS</span><strong>没有匹配的跨源节点</strong><button onClick={() => setQuery('')} type="button">清除检索</button></div>
                  )}
                </div>
                <div className="discovery-detail" data-open={detailOpen}>
                  <button className="discovery-detail-close" onClick={() => setDetailOpen(false)} type="button"><span>返回共识索引</span><b>×</b></button>
                  <div className="discovery-detail-body" ref={detailBodyRef}>
                    {selectedConsensus && (
                      <ConsensusDossier
                        evidenceUnitId={evidenceUnitId}
                        node={selectedConsensus}
                        onCloseEvidence={() => setEvidenceUnitId(null)}
                        onOpenEvidence={setEvidenceUnitId}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {currentState === 'loaded' && view === 'harness' && (
              <div className="discovery-split">
                <div className="discovery-list harness-list" aria-label="研究候选方法">
                  {visibleCandidates.map((candidate, index) => (
                    <button
                      aria-pressed={selectedCandidate?.node_id === candidate.node_id}
                      className="discovery-index-row"
                      data-discovery-key={`candidate-${candidate.node_id}`}
                      key={candidate.node_id}
                      onClick={() => {
                        setSelectedCandidateId(candidate.node_id)
                        openOnMobile()
                      }}
                      onFocus={() => setSelectedCandidateId(candidate.node_id)}
                      onKeyDown={(event) => rowKeyboardNavigation(
                        event,
                        index,
                        visibleCandidates,
                        (row) => setSelectedCandidateId(row.node_id),
                        (row) => `candidate-${row.node_id}`,
                      )}
                      type="button"
                    >
                      <span className="discovery-index-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <b>{candidate.payload.family ?? 'other'} · TESTABILITY A</b>
                        <strong>{candidate.title}</strong>
                        <p>{candidate.payload.summary ?? candidate.canonical}</p>
                        <em>{candidate.payload.data_requirements?.length ?? 0} 项数据需求</em>
                      </span>
                    </button>
                  ))}
                  {visibleCandidates.length === 0 && (
                    <div className="discovery-list-empty"><span>NO CANDIDATE</span><strong>没有匹配的研究候选</strong><button onClick={() => setQuery('')} type="button">清除检索</button></div>
                  )}
                </div>
                <div className="discovery-detail" data-open={detailOpen}>
                  <button className="discovery-detail-close" onClick={() => setDetailOpen(false)} type="button"><span>返回候选索引</span><b>×</b></button>
                  <div className="discovery-detail-body" ref={detailBodyRef}>
                    {selectedCandidate && <HarnessDossier candidate={selectedCandidate} />}
                  </div>
                </div>
              </div>
            )}

            {currentState === 'loaded' && view === 'weekly' && weekly && (
              <div className="weekly-reader" ref={detailBodyRef}>
                <WeeklyDossier
                  evidenceUnitId={evidenceUnitId}
                  onCloseEvidence={() => setEvidenceUnitId(null)}
                  onOpenEvidence={setEvidenceUnitId}
                  report={weekly}
                  spotChecks={spotChecks}
                />
              </div>
            )}
          </section>
        </section>
      </main>

      <footer className="discovery-footer">
        <span>FANISL / DISCOVERY WITHOUT SYNTHESIS</span>
        <p>分歧不被抹平，候选不被包装成结论，每条关系都回到证据。</p>
      </footer>
    </div>
  )
}

export default DiscoveryPage
