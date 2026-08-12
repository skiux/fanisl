import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import ContentTimeline from './ContentTimeline'
import EvidenceDossier from './EvidenceDossier'
import UnitBrowser from './UnitBrowser'
import { previewNodes } from './preview'
import type {
  AttestationRelation,
  KnowledgeContentSummary,
  KnowledgeCreator,
  KnowledgeKind,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeUnitSummary,
  NodeRelationKind,
  NodeStatus,
} from './types'
import './knowledge.css'

const kindLabels: Record<KnowledgeKind, string> = {
  claim: '判断',
  method: '方法',
  concept: '认知',
}

const statusLabels: Record<NodeStatus, string> = {
  active: '活跃',
  corroborated: '多源佐证',
  verified: '已验证',
  contested: '存在争议',
  retired: '已退役',
}

const attestationLabels: Record<AttestationRelation, string> = {
  restates: '重申',
  refines: '细化',
  supersedes: '修正',
  contradicts: '反驳',
}

const relationLabels: Record<NodeRelationKind, string> = {
  conflicts: '对立命题',
  relates: '互补关联',
}

const outcomeLabels: Record<string, string> = {
  hit: '命中',
  partial: '部分',
  miss: '未中',
  condition_not_met: '条件未触发',
  pending: '待复核',
  unpriceable: '无价格',
  condition_unverifiable: '条件不可验',
}

type KindFilter = 'all' | KnowledgeKind
type StatusFilter = 'all' | NodeStatus
type SortMode = 'evidence' | 'recent'
type LoadMode = 'loading' | 'live' | 'preview'
type DetailMode = 'idle' | 'loading' | 'loaded' | 'error' | 'preview'
type LibraryView = 'library' | 'sources' | 'evidence'

function compareEvidence(a: KnowledgeNode, b: KnowledgeNode) {
  return b.n_attest - a.n_attest || b.n_creators - a.n_creators || a.id - b.id
}

function compareRecent(a: KnowledgeNode, b: KnowledgeNode) {
  return (Date.parse(b.last_seen ?? b.updated_at ?? '') || 0)
    - (Date.parse(a.last_seen ?? a.updated_at ?? '') || 0)
    || compareEvidence(a, b)
}

function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function nodeIdFromHash() {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const value = Number(new URLSearchParams(query).get('node'))
  return Number.isInteger(value) && value > 0 ? value : null
}

function evidenceLabel(node: KnowledgeNode) {
  const scoreCount = node.hit + node.partial + node.miss
  if (node.status === 'contested') return '出现反证'
  if (node.status === 'verified') return '市场验证'
  if (node.n_creators > 1) return '跨源印证'
  if (node.notes && /修正|演进|取代|supersedes/i.test(node.notes)) return '观点修正'
  if (scoreCount > 0) return '已有裁决'
  if (node.n_attest > 1) return '持续重申'
  return '单次沉淀'
}

function buildSpotlights(nodes: KnowledgeNode[]) {
  const groups = [
    nodes.filter((node) => node.n_creators > 1).sort(compareRecent),
    nodes.filter((node) => node.notes && /修正|演进|取代|supersedes/i.test(node.notes)).sort(compareRecent),
    nodes.filter((node) => node.hit + node.partial + node.miss > 0).sort(compareRecent),
    nodes.filter((node) => node.n_attest > 1).sort(compareRecent),
    [...nodes].sort(compareRecent),
  ]
  const selected: KnowledgeNode[] = []
  for (const group of groups) {
    const candidate = group.find((node) => !selected.some((item) => item.id === node.id))
    if (candidate) selected.push(candidate)
    if (selected.length === 3) break
  }
  return selected
}

function KnowledgeTrace({ node }: { node: KnowledgeNode }) {
  const count = Math.max(1, Math.min(node.n_attest, 6))
  const firstSeen = formatDate(node.first_seen)
  const lastSeen = formatDate(node.last_seen)

  return (
    <span className="knowledge-trace" aria-label={`${node.n_attest} 次提及`}>
      <span className="trace-dates">
        <time>{firstSeen ?? '单次记录'}</time>
        <time>{lastSeen && lastSeen !== firstSeen ? lastSeen : ''}</time>
      </span>
      <span className="trace-line" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <i key={index} />)}
      </span>
      <span className="trace-summary">
        <b>{node.n_attest}</b> 次提及 · <b>{node.n_creators}</b> 位信源
      </span>
    </span>
  )
}

function KnowledgePage() {
  const initialNodeIdRef = useRef(nodeIdFromHash())
  const searchRef = useRef<HTMLInputElement>(null)
  const detailCacheRef = useRef(new Map<number, KnowledgeNodeDetail>())
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [loadMode, setLoadMode] = useState<LoadMode>('loading')
  const [libraryView, setLibraryView] = useState<LibraryView>(
    window.location.hash.includes('search=1') ? 'evidence' : 'library',
  )
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [crossSource, setCrossSource] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('evidence')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(initialNodeIdRef.current)
  const [readerOpen, setReaderOpen] = useState(initialNodeIdRef.current !== null)
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [detailMode, setDetailMode] = useState<DetailMode>('idle')
  const [detailRequestKey, setDetailRequestKey] = useState(0)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)

  const [contents, setContents] = useState<KnowledgeContentSummary[]>([])
  const [creators, setCreators] = useState<KnowledgeCreator[]>([])
  const [units, setUnits] = useState<KnowledgeUnitSummary[]>([])
  const [secondaryMode, setSecondaryMode] = useState<LoadMode>('loading')
  const [secondaryLoaded, setSecondaryLoaded] = useState(false)
  const [selectedContentId, setSelectedContentId] = useState<number | null>(null)
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null)
  const [unitSearchFocusKey, setUnitSearchFocusKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal })
      .then((payload) => {
        setNodes(payload)
        setSelectedId((current) => payload.some((node) => node.id === current)
          ? current
          : [...payload].sort(compareEvidence)[0]?.id ?? null)
        setLoadMode('live')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setNodes(previewNodes)
        setSelectedId((current) => previewNodes.some((node) => node.id === current)
          ? current
          : [...previewNodes].sort(compareEvidence)[0]?.id ?? null)
        setLoadMode('preview')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (libraryView === 'library' || secondaryLoaded || loadMode === 'loading') return
    if (loadMode === 'preview') {
      setSecondaryMode('preview')
      setSecondaryLoaded(true)
      return
    }

    const controller = new AbortController()
    setSecondaryMode('loading')
    Promise.all([
      apiJson<KnowledgeCreator[]>('/knowledge/creators', { signal: controller.signal }),
      apiJson<KnowledgeContentSummary[]>('/knowledge/contents?limit=200', { signal: controller.signal }),
      apiJson<KnowledgeUnitSummary[]>('/knowledge/units?limit=500', { signal: controller.signal }),
    ]).then(([creatorRows, contentRows, unitRows]) => {
      setCreators(creatorRows)
      setContents(contentRows)
      setUnits(unitRows)
      setSelectedContentId(contentRows[0]?.id ?? null)
      setSelectedUnitId(unitRows[0]?.id ?? null)
      setSecondaryMode('live')
      setSecondaryLoaded(true)
    }).catch(() => {
      if (controller.signal.aborted) return
      setSecondaryMode('preview')
      setSecondaryLoaded(true)
    })
    return () => controller.abort()
  }, [libraryView, loadMode, secondaryLoaded])

  const typeCounts = useMemo(() => ({
    all: nodes.length,
    concept: nodes.filter((node) => node.kind === 'concept').length,
    method: nodes.filter((node) => node.kind === 'method').length,
    claim: nodes.filter((node) => node.kind === 'claim').length,
  }), [nodes])

  const statusCounts = useMemo(() => {
    const counts = new Map<NodeStatus, number>()
    nodes.forEach((node) => counts.set(node.status, (counts.get(node.status) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [nodes])

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    nodes.forEach((node) => node.tags.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  }, [nodes])

  const spotlights = useMemo(() => buildSpotlights(nodes), [nodes])

  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = nodes.filter((node) => {
      if (kind !== 'all' && node.kind !== kind) return false
      if (status !== 'all' && node.status !== status) return false
      if (tag && !node.tags.includes(tag)) return false
      if (crossSource && node.n_creators < 2) return false
      if (!normalizedQuery) return true
      return `${node.title} ${node.canonical} ${node.notes ?? ''} ${node.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    })
    return filtered.sort(sortMode === 'recent' ? compareRecent : compareEvidence)
  }, [crossSource, kind, nodes, query, sortMode, status, tag])

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null
  const selectedPosition = selectedNode
    ? Math.max(1, visibleNodes.findIndex((node) => node.id === selectedNode.id) + 1)
    : 0
  const hasActiveFilters = kind !== 'all'
    || status !== 'all'
    || tag !== null
    || crossSource
    || query.trim().length > 0
  const drawerFilterCount = Number(status !== 'all') + Number(tag !== null) + Number(crossSource)

  useEffect(() => {
    if (!readerOpen || libraryView !== 'library' || !selectedNode) {
      setDetail(null)
      setDetailMode('idle')
      return
    }
    if (loadMode === 'preview') {
      setDetail({ ...selectedNode, attestations: [], relations: [] })
      setDetailMode('preview')
      return
    }
    if (loadMode !== 'live') return

    const cached = detailCacheRef.current.get(selectedNode.id)
    if (cached) {
      setDetail(cached)
      setDetailMode('loaded')
      return
    }

    const controller = new AbortController()
    setDetail(null)
    setDetailMode('loading')
    apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${selectedNode.id}`, { signal: controller.signal })
      .then((payload) => {
        const complete = { ...selectedNode, ...payload }
        detailCacheRef.current.set(selectedNode.id, complete)
        setDetail(complete)
        setDetailMode('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailMode('error')
      })
    return () => controller.abort()
  }, [detailRequestKey, libraryView, loadMode, readerOpen, selectedNode])

  useEffect(() => {
    const syncFromHistory = () => {
      const nextNodeId = nodeIdFromHash()
      setSelectedId(nextNodeId)
      setReaderOpen(nextNodeId !== null)
      setEvidenceUnitId(null)
      if (nextNodeId !== null) setLibraryView('library')
    }
    window.addEventListener('popstate', syncFromHistory)
    return () => window.removeEventListener('popstate', syncFromHistory)
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLibraryView('evidence')
        setReaderOpen(false)
        setEvidenceUnitId(null)
        setUnitSearchFocusKey((value) => value + 1)
      }
      if (event.key !== 'Escape') return
      if (evidenceUnitId !== null) {
        setEvidenceUnitId(null)
      } else if (filtersOpen) {
        setFiltersOpen(false)
      } else if (readerOpen && libraryView === 'library') {
        closeNode()
      } else if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  useEffect(() => {
    if (!filtersOpen && evidenceUnitId === null) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [evidenceUnitId, filtersOpen])

  const resetFilters = () => {
    setKind('all')
    setStatus('all')
    setTag(null)
    setCrossSource(false)
    setQuery('')
  }

  const openNode = (node: KnowledgeNode) => {
    setSelectedId(node.id)
    setReaderOpen(true)
    setEvidenceUnitId(null)
    window.history.pushState({ fanislNode: node.id }, '', `#/knowledge?node=${node.id}`)
    window.scrollTo({ left: 0, top: 0 })
  }

  const closeNode = () => {
    setReaderOpen(false)
    setEvidenceUnitId(null)
    window.history.replaceState(null, '', '#/knowledge')
    window.scrollTo({ left: 0, top: 0 })
  }

  const openRelatedNode = (nodeId: number) => {
    const target = nodes.find((node) => node.id === nodeId)
    if (!target) return
    setSelectedId(target.id)
    setEvidenceUnitId(null)
    window.history.replaceState({ fanislNode: target.id }, '', `#/knowledge?node=${target.id}`)
    window.scrollTo({ left: 0, top: 0 })
  }

  const selectView = (view: LibraryView) => {
    setLibraryView(view)
    setReaderOpen(false)
    setFiltersOpen(false)
    setEvidenceUnitId(null)
    window.history.replaceState(null, '', '#/knowledge')
    window.scrollTo({ left: 0, top: 0 })
    if (view === 'evidence') setUnitSearchFocusKey((value) => value + 1)
  }

  const handleNodeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleNodes.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleNodes.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    document.querySelector<HTMLButtonElement>(`[data-node-id="${visibleNodes[nextIndex].id}"]`)?.focus()
  }

  const headerSearch = () => {
    selectView('evidence')
  }

  if (readerOpen && libraryView === 'library' && selectedNode) {
    return (
      <div className="knowledge-page knowledge-document-page">
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="knowledge-document-stage">
          <button className="document-back" onClick={closeNode} type="button">
            <span>←</span> 返回知识库
          </button>
          <NodeReader
            detail={detail}
            detailMode={detailMode}
            node={selectedNode}
            onOpenRelated={openRelatedNode}
            onOpenUnit={setEvidenceUnitId}
            onRetry={() => setDetailRequestKey((value) => value + 1)}
            position={selectedPosition}
            total={visibleNodes.length || nodes.length}
          />
          {evidenceUnitId !== null && (
            <div className="knowledge-evidence-layer">
              <EvidenceDossier
                onClose={() => setEvidenceUnitId(null)}
                parentTitle={selectedNode.title}
                unitId={evidenceUnitId}
              />
            </div>
          )}
        </main>
      </div>
    )
  }

  if (libraryView !== 'library') {
    const isSources = libraryView === 'sources'
    return (
      <div className="knowledge-page knowledge-secondary-page">
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="knowledge-secondary-stage">
          <header className="secondary-lead">
            <button onClick={() => selectView('library')} type="button">← 返回长期知识</button>
            <span>{isSources ? 'SOURCE CONTENT' : 'EVIDENCE SEARCH'}</span>
            <h1>{isSources ? '来源内容' : '逐字证据'}</h1>
            <p>{isSources
              ? '从一期内容进入，先读其中留下的判断、方法与认知，再按需核查完整转录。'
              : '跨内容检索逐字引文与结构字段。这里是证据入口，不替代长期知识节点。'}</p>
          </header>

          <section className={`knowledge-secondary-frame view-${isSources ? 'timeline' : 'units'}`}>
            <button
              aria-label="关闭当前面板"
              className="frame-backdrop"
              data-open={filtersOpen || readerOpen}
              onClick={() => {
                setFiltersOpen(false)
                setReaderOpen(false)
                setEvidenceUnitId(null)
              }}
              type="button"
            />
            {isSources ? (
              <ContentTimeline
                contents={contents}
                evidenceUnitId={evidenceUnitId}
                isLoading={secondaryMode === 'loading'}
                isPreview={secondaryMode === 'preview'}
                onCloseEvidence={() => setEvidenceUnitId(null)}
                onCloseReader={() => {
                  setReaderOpen(false)
                  setEvidenceUnitId(null)
                }}
                onOpenEvidence={setEvidenceUnitId}
                onSelectContent={(id, open) => {
                  setSelectedContentId(id)
                  if (open) setReaderOpen(true)
                }}
                readerOpen={readerOpen}
                selectedContentId={selectedContentId}
              />
            ) : (
              <UnitBrowser
                creators={creators}
                filtersOpen={filtersOpen}
                focusRequestKey={unitSearchFocusKey}
                initialUnits={units}
                isPreview={secondaryMode === 'preview'}
                onCloseFilters={() => setFiltersOpen(false)}
                onCloseReader={() => setReaderOpen(false)}
                onOpenFilters={() => setFiltersOpen(true)}
                onSelectUnit={(id, open) => {
                  setSelectedUnitId(id)
                  if (open) setReaderOpen(true)
                }}
                readerOpen={readerOpen}
                selectedUnitId={selectedUnitId}
              />
            )}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="knowledge-page">
      <div aria-hidden="true" className="knowledge-material" />
      <AppHeader current="knowledge" onSearch={headerSearch} />

      <main className="knowledge-stage">
        <header className="knowledge-lead">
          <div className="lead-copy">
            <span>KNOWLEDGE / 01</span>
            <h1>知识库</h1>
            <p>不是内容的仓库，而是从原始表达中持续形成、修正并保留证据的长期认知。</p>
          </div>

          <div className="lead-actions">
            <label className="knowledge-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索长期知识"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索主题、标的或知识陈述"
                ref={searchRef}
                value={query}
              />
              {query && <button aria-label="清空搜索" onClick={() => setQuery('')} type="button">×</button>}
            </label>
            <p>
              <strong>{loadMode === 'loading' ? '—' : nodes.length}</strong> 条长期知识
              <i />
              <strong>{nodes.filter((node) => node.n_attest > 1).length}</strong> 条持续演进
            </p>
            <div className="knowledge-utilities">
              <button onClick={() => selectView('sources')} type="button">浏览来源内容 <span>↗</span></button>
              <button onClick={() => selectView('evidence')} type="button">检索逐字证据 <span>⌘K</span></button>
            </div>
          </div>
        </header>

        {loadMode === 'preview' && (
          <div className="preview-notice">
            <i />
            <span>后端未连接，当前显示仓库内的真实归并样本。</span>
          </div>
        )}

        {!hasActiveFilters && loadMode !== 'loading' && spotlights.length > 0 && (
          <section className="knowledge-brief">
            <header>
              <span>RECENTLY FORMED</span>
              <h2>值得先读的知识</h2>
              <p>优先呈现跨源印证、观点修正与已有市场裁决的节点。</p>
            </header>
            <ol>
              {spotlights.map((node, index) => (
                <li key={node.id}>
                  <button onClick={() => openNode(node)} type="button">
                    <span className="brief-index">0{index + 1}</span>
                    <span className="brief-body">
                      <span><b>{evidenceLabel(node)}</b><em>{kindLabels[node.kind]}</em></span>
                      <strong>{node.title}</strong>
                      <p>{node.canonical}</p>
                    </span>
                    <KnowledgeTrace node={node} />
                    <i className="brief-arrow">↗</i>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="knowledge-index">
          <header className="index-head">
            <div>
              <span>LONG-TERM KNOWLEDGE</span>
              <h2>{query ? `“${query}”的检索结果` : tag ? `主题 / ${tag}` : '全部长期知识'}</h2>
            </div>
            <p><strong>{loadMode === 'loading' ? '—' : visibleNodes.length}</strong> 条</p>
          </header>

          <div className="topic-strip" aria-label="高频主题">
            <button aria-pressed={tag === null} onClick={() => setTag(null)} type="button">全部主题</button>
            {popularTags.map(([item, count]) => (
              <button
                aria-pressed={tag === item}
                key={item}
                onClick={() => setTag(tag === item ? null : item)}
                type="button"
              >
                {item}<small>{count}</small>
              </button>
            ))}
          </div>

          <div className="index-controls">
            <div className="kind-switch" aria-label="知识类型">
              {([
                ['all', '全部'],
                ['concept', '认知'],
                ['method', '方法'],
                ['claim', '判断'],
              ] as const).map(([value, label]) => (
                <button aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">
                  {label}<small>{typeCounts[value]}</small>
                </button>
              ))}
            </div>
            <div className="index-options">
              <button
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
                type="button"
              >
                筛选{drawerFilterCount ? ` · ${drawerFilterCount}` : ''}
              </button>
              <label>
                <span>排序</span>
                <select onChange={(event) => setSortMode(event.target.value as SortMode)} value={sortMode}>
                  <option value="evidence">证据优先</option>
                  <option value="recent">最近演进</option>
                </select>
              </label>
              {hasActiveFilters && <button className="clear-filters" onClick={resetFilters} type="button">清除条件</button>}
            </div>
          </div>

          <div className="knowledge-list" aria-busy={loadMode === 'loading'}>
            {loadMode === 'loading' && [0, 1, 2, 3].map((item) => (
              <div className="knowledge-row knowledge-row-skeleton" key={item}><i /><span /><span /></div>
            ))}

            {loadMode !== 'loading' && visibleNodes.map((node, index) => {
              const scoreCount = node.hit + node.partial + node.miss
              return (
                <button
                  className={`knowledge-row kind-${node.kind}`}
                  data-node-id={node.id}
                  key={node.id}
                  onClick={() => openNode(node)}
                  onKeyDown={(event) => handleNodeKeyDown(event, index)}
                  type="button"
                >
                  <span className="row-index">{String(index + 1).padStart(3, '0')}</span>
                  <span className="row-main">
                    <span className="row-meta">
                      <b>{kindLabels[node.kind]}</b>
                      <i />
                      <em>{statusLabels[node.status]}</em>
                      {scoreCount > 0 && <small>{scoreCount} 个裁决时点</small>}
                    </span>
                    <strong>{node.title}</strong>
                    <span className="row-canonical">{node.canonical}</span>
                    <span className="row-tags">
                      {node.tags.slice(0, 4).map((item) => <em key={item}>{item}</em>)}
                    </span>
                  </span>
                  <KnowledgeTrace node={node} />
                  <span className="row-open">阅读 <i>↗</i></span>
                </button>
              )
            })}

            {loadMode !== 'loading' && visibleNodes.length === 0 && (
              <div className="knowledge-empty">
                <span>NO MATCHED KNOWLEDGE</span>
                <strong>没有匹配的长期知识</strong>
                <p>当前条件同时作用于标题、规范陈述、归并说明和主题标签。</p>
                <button onClick={resetFilters} type="button">清除全部条件</button>
              </div>
            )}
          </div>
        </section>

        <section className="knowledge-gateways">
          <header>
            <span>TRACE THE SOURCE</span>
            <h2>需要核查时，再回到证据。</h2>
          </header>
          <button onClick={() => selectView('sources')} type="button">
            <span>来源内容</span><p>按发布时间阅读每期内容留下的判断、方法与认知。</p><i>↗</i>
          </button>
          <button onClick={() => selectView('evidence')} type="button">
            <span>逐字证据</span><p>跨内容检索引文、标的、条件和冻结判据。</p><i>↗</i>
          </button>
        </section>
      </main>

      <button
        aria-label="关闭筛选"
        className="filter-backdrop"
        data-open={filtersOpen}
        onClick={() => setFiltersOpen(false)}
        type="button"
      />
      <aside className="knowledge-filter" data-open={filtersOpen}>
        <header><span>筛选长期知识</span><button onClick={() => setFiltersOpen(false)} type="button">完成</button></header>
        <section>
          <p>生命周期</p>
          <button aria-pressed={status === 'all'} onClick={() => setStatus('all')} type="button">
            <span>全部状态</span><b>{nodes.length}</b>
          </button>
          {statusCounts.map(([value, count]) => (
            <button aria-pressed={status === value} key={value} onClick={() => setStatus(value)} type="button">
              <span>{statusLabels[value]}</span><b>{count}</b>
            </button>
          ))}
        </section>
        <section>
          <p>证据范围</p>
          <label className="cross-source-toggle">
            <input checked={crossSource} onChange={(event) => setCrossSource(event.target.checked)} type="checkbox" />
            <span><i /></span><b>只看跨信源节点</b>
          </label>
        </section>
        <footer>
          <span>{drawerFilterCount ? `${drawerFilterCount} 个条件` : '未设置额外条件'}</span>
          {drawerFilterCount > 0 && <button onClick={resetFilters} type="button">清除</button>}
        </footer>
      </aside>

      <footer className="knowledge-footer">
        <span>FANISL / KNOWLEDGE WITH PROVENANCE</span>
        <p>节点不是结论的终点，而是下一次证据进入的位置。</p>
      </footer>
    </div>
  )
}

function NodeReader({
  detail,
  detailMode,
  node,
  onOpenRelated,
  onOpenUnit,
  onRetry,
  position,
  total,
}: {
  detail: KnowledgeNodeDetail | null
  detailMode: DetailMode
  node: KnowledgeNode
  onOpenRelated: (nodeId: number) => void
  onOpenUnit: (unitId: number) => void
  onRetry: () => void
  position: number
  total: number
}) {
  const scoreCount = node.hit + node.partial + node.miss
  const weightedHitRate = scoreCount
    ? Math.round(((node.hit + node.partial * 0.5) / scoreCount) * 100)
    : null

  return (
    <article className={`knowledge-document kind-${node.kind}`}>
      <header className="document-lead">
        <div className="document-kicker">
          <span>NODE / {String(node.id).padStart(3, '0')}</span>
          <p><b>{String(position).padStart(2, '0')}</b> / {String(total).padStart(2, '0')}</p>
        </div>
        <div className="document-status">
          <span><i />{kindLabels[node.kind]}</span>
          <b>{statusLabels[node.status]}</b>
        </div>
        <h1>{node.title}</h1>
        <p className="document-canonical">{node.canonical}</p>
        <div className="document-tags">{node.tags.map((item) => <span key={item}>{item}</span>)}</div>
        <dl className="document-facts">
          <div><dt>提及</dt><dd>{node.n_attest}</dd></div>
          <div><dt>原始内容</dt><dd>{node.n_contents}</dd></div>
          <div><dt>独立信源</dt><dd>{node.n_creators}</dd></div>
          <div><dt>时间跨度</dt><dd>{formatDate(node.first_seen) ?? '—'} — {formatDate(node.last_seen) ?? '—'}</dd></div>
        </dl>
      </header>

      <section className="document-section merge-story">
        <header><span>01</span><div><h2>这条知识如何形成</h2><p>归并不是删除差异，而是记录重复、细化与修正。</p></div></header>
        <blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote>
      </section>

      <section className="document-section evolution-story">
        <header><span>02</span><div><h2>提及与演进</h2><p>从早到晚保留每一次重申、细化、修正或反驳。</p></div></header>
        {detailMode === 'loading' && <div className="document-loading"><i /><i /><i /></div>}
        {detailMode === 'error' && (
          <div className="document-error"><p>完整证据暂时没有载入。</p><button onClick={onRetry} type="button">重新读取</button></div>
        )}
        {detailMode === 'preview' && <p className="document-preview">预览样本只包含节点摘要；连接后端后会显示完整提及链。</p>}
        {detailMode === 'loaded' && detail && detail.attestations.length === 0 && <p className="document-preview">该节点尚未返回提及记录。</p>}
        {detailMode === 'loaded' && detail && detail.attestations.length > 0 && (
          <ol className="evolution-timeline">
            {detail.attestations.map((attestation, index) => (
              <li className={`relation-${attestation.relation}`} key={`${attestation.unit_id}-${index}`}>
                <div className="evolution-date"><time>{formatDate(attestation.published_at, true) ?? '日期未知'}</time><i /></div>
                <article>
                  <header><span>{attestationLabels[attestation.relation]}</span><b>{attestation.creator}</b></header>
                  {attestation.note && <p>{attestation.note}</p>}
                  <blockquote>{attestation.quote}</blockquote>
                  <footer>
                    <span>{attestation.content_title}</span>
                    <button onClick={() => onOpenUnit(attestation.unit_id)} type="button">核查逐字证据 <i>#{attestation.unit_id} →</i></button>
                  </footer>
                  {attestation.scores.length > 0 && (
                    <div className="evolution-scores">
                      {attestation.scores.map((score) => (
                        <span className={`outcome-${score.outcome}`} key={score.id}>
                          {score.horizon_label} · {outcomeLabels[score.outcome] ?? score.outcome}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="document-section verdict-story">
        <header><span>03</span><div><h2>市场裁决</h2><p>只统计机械执行冻结判据后得到的有效评分时点。</p></div></header>
        {scoreCount ? (
          <div className="verdict-summary">
            <strong>{weightedHitRate}%</strong><span>加权命中率 · n={scoreCount}</span>
            <div aria-label={`命中 ${node.hit}，部分 ${node.partial}，未中 ${node.miss}`}>
              <i style={{ flex: node.hit || 0.001 }} /><i style={{ flex: node.partial || 0.001 }} /><i style={{ flex: node.miss || 0.001 }} />
            </div>
            <p><span>命中 {node.hit}</span><span>部分 {node.partial}</span><span>未中 {node.miss}</span></p>
          </div>
        ) : (
          <p className="verdict-empty">没有 0%，只有尚未到期、尚未形成足够样本，或这类知识本身不直接评分。</p>
        )}
      </section>

      <section className="document-section relation-story">
        <header><span>04</span><div><h2>与其他知识的关系</h2><p>对立命题保留分歧，互补命题提供继续阅读的方向。</p></div></header>
        {detailMode === 'loaded' && detail && detail.relations.length > 0 ? (
          <div className="document-relations">
            {detail.relations.map((relation) => (
              <button key={`${relation.relation}-${relation.other_id}`} onClick={() => onOpenRelated(relation.other_id)} type="button">
                <span><b>{relationLabels[relation.relation]}</b><em>{kindLabels[relation.other_kind]} · {statusLabels[relation.other_status]}</em></span>
                <strong>{relation.other_title}</strong><p>{relation.note}</p><i>打开节点 ↗</i>
              </button>
            ))}
          </div>
        ) : (
          <p className="relation-empty">当前没有经过人工确认的对立或互补关系。</p>
        )}
      </section>

      <footer className="document-foot"><span>节点会随新证据继续演进</span><b>PROVENANCE INTACT</b></footer>
    </article>
  )
}

export default KnowledgePage
