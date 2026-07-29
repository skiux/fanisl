import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import ContentTimeline from './ContentTimeline'
import EvidenceDossier from './EvidenceDossier'
import UnitBrowser from './UnitBrowser'
import { previewNodes, previewStats } from './preview'
import type {
  AttestationRelation,
  KnowledgeContentSummary,
  KnowledgeCreator,
  KnowledgeKind,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeStats,
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
type LibraryView = 'nodes' | 'timeline' | 'units'

function compareEvidence(a: KnowledgeNode, b: KnowledgeNode) {
  return b.n_attest - a.n_attest || b.n_creators - a.n_creators || a.id - b.id
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('zh-CN', {
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

function KnowledgePage() {
  const startsInUnitSearch = window.location.hash.includes('search=1')
  const startsAtNodeId = nodeIdFromHash()
  const searchRef = useRef<HTMLInputElement>(null)
  const detailCacheRef = useRef(new Map<number, KnowledgeNodeDetail>())
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [contents, setContents] = useState<KnowledgeContentSummary[]>([])
  const [creators, setCreators] = useState<KnowledgeCreator[]>([])
  const [units, setUnits] = useState<KnowledgeUnitSummary[]>([])
  const [stats, setStats] = useState<KnowledgeStats>(previewStats)
  const [loadMode, setLoadMode] = useState<LoadMode>('loading')
  const [libraryView, setLibraryView] = useState<LibraryView>(startsInUnitSearch ? 'units' : 'nodes')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [crossSource, setCrossSource] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('evidence')
  const [selectedId, setSelectedId] = useState<number | null>(startsAtNodeId)
  const [readerOpen, setReaderOpen] = useState(startsAtNodeId !== null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [detailMode, setDetailMode] = useState<DetailMode>('idle')
  const [detailRequestKey, setDetailRequestKey] = useState(0)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)
  const [selectedContentId, setSelectedContentId] = useState<number | null>(null)
  const [selectedBrowseUnitId, setSelectedBrowseUnitId] = useState<number | null>(null)
  const [unitSearchFocusKey, setUnitSearchFocusKey] = useState(startsInUnitSearch ? 1 : 0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [nodeRows, creatorRows, contentRows, unitRows] = await Promise.all([
          apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal }),
          apiJson<KnowledgeCreator[]>('/knowledge/creators', { signal: controller.signal }),
          apiJson<KnowledgeContentSummary[]>('/knowledge/contents?limit=200', { signal: controller.signal }),
          apiJson<KnowledgeUnitSummary[]>('/knowledge/units?limit=500', { signal: controller.signal }),
        ])
        setNodes(nodeRows)
        setCreators(creatorRows)
        setContents(contentRows)
        setUnits(unitRows)
        setStats({
          nodes: nodeRows.length,
          contents: contentRows.length,
          units: unitRows.length,
          creators: creatorRows.length,
          corroborated: nodeRows.filter((node) => node.status === 'corroborated').length,
        })
        setSelectedId(nodeRows.some((node) => node.id === startsAtNodeId)
          ? startsAtNodeId
          : [...nodeRows].sort(compareEvidence)[0]?.id ?? null)
        setSelectedContentId(contentRows[0]?.id ?? null)
        setSelectedBrowseUnitId(unitRows[0]?.id ?? null)
        setLoadMode('live')
      } catch {
        if (controller.signal.aborted) return
        setNodes(previewNodes)
        setCreators([])
        setContents([])
        setUnits([])
        setStats(previewStats)
        setSelectedId([...previewNodes].sort(compareEvidence)[0]?.id ?? null)
        setLoadMode('preview')
      }
    }

    void load()
    return () => controller.abort()
  }, [startsAtNodeId])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLibraryView('units')
        setReaderOpen(false)
        setEvidenceUnitId(null)
        setUnitSearchFocusKey((value) => value + 1)
      }
      if (event.key !== 'Escape') return
      if (evidenceUnitId !== null) {
        setEvidenceUnitId(null)
        return
      }
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
      setReaderOpen(false)
      setFiltersOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [evidenceUnitId])

  useEffect(() => {
    const isNarrow = window.matchMedia('(max-width: 900px)').matches
    if (!isNarrow || (!readerOpen && !filtersOpen)) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [filtersOpen, readerOpen])

  const typeCounts = useMemo(() => ({
    all: nodes.length,
    concept: nodes.filter((node) => node.kind === 'concept').length,
    method: nodes.filter((node) => node.kind === 'method').length,
    claim: nodes.filter((node) => node.kind === 'claim').length,
  }), [nodes])

  const availableStatuses = useMemo(() => {
    const counts = new Map<NodeStatus, number>()
    nodes.forEach((node) => counts.set(node.status, (counts.get(node.status) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [nodes])

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    nodes.forEach((node) => node.tags.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7)
  }, [nodes])

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

    return filtered.sort((a, b) => {
      if (sortMode === 'recent') {
        return (Date.parse(b.last_seen ?? b.updated_at ?? '') || 0)
          - (Date.parse(a.last_seen ?? a.updated_at ?? '') || 0)
      }
      return compareEvidence(a, b)
    })
  }, [crossSource, kind, nodes, query, sortMode, status, tag])

  const selectedNode = visibleNodes.find((node) => node.id === selectedId)
    ?? visibleNodes[0]
    ?? null
  const selectedPosition = selectedNode
    ? visibleNodes.findIndex((node) => node.id === selectedNode.id) + 1
    : 0

  useEffect(() => {
    if (!selectedNode) {
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

    apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${selectedNode.id}`, {
      signal: controller.signal,
    }).then((payload) => {
      const completeDetail = { ...selectedNode, ...payload }
      detailCacheRef.current.set(selectedNode.id, completeDetail)
      setDetail(completeDetail)
      setDetailMode('loaded')
    }).catch(() => {
      if (controller.signal.aborted) return
      setDetailMode('error')
    })

    return () => controller.abort()
  }, [detailRequestKey, loadMode, selectedNode])

  const hasActiveFilters = kind !== 'all'
    || status !== 'all'
    || tag !== null
    || crossSource
    || query.trim().length > 0

  const resetFilters = () => {
    setKind('all')
    setStatus('all')
    setTag(null)
    setCrossSource(false)
    setQuery('')
  }

  const openRelatedNode = (nodeId: number) => {
    const target = nodes.find((node) => node.id === nodeId)
    if (!target) return
    resetFilters()
    setEvidenceUnitId(null)
    setSelectedId(target.id)
    setReaderOpen(true)
  }

  const openEvidenceUnit = (unitId: number) => {
    setEvidenceUnitId(unitId)
    if (window.matchMedia('(min-width: 901px)').matches) {
      requestAnimationFrame(() => {
        document.querySelector('.library-frame')?.scrollIntoView({ block: 'start' })
      })
    }
  }

  const selectLibraryView = (view: LibraryView) => {
    setLibraryView(view)
    setEvidenceUnitId(null)
    setReaderOpen(false)
    setFiltersOpen(false)
  }

  const selectContent = (contentId: number, openOnMobile = false) => {
    setEvidenceUnitId(null)
    setSelectedContentId(contentId)
    if (openOnMobile) setReaderOpen(true)
  }

  const selectBrowseUnit = (unitId: number, openOnMobile = false) => {
    setSelectedBrowseUnitId(unitId)
    if (openOnMobile) setReaderOpen(true)
  }

  const selectNode = (node: KnowledgeNode, openOnMobile = false) => {
    setEvidenceUnitId(null)
    setSelectedId(node.id)
    if (openOnMobile) setReaderOpen(true)
  }

  const handleNodeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleNodes.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleNodes.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const nextNode = visibleNodes[nextIndex]
    setSelectedId(nextNode.id)
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-node-id="${nextNode.id}"]`)?.focus()
    })
  }

  return (
    <div className="knowledge-page">
      <div aria-hidden="true" className="knowledge-material" />
      <AppHeader
        current="knowledge"
        onSearch={() => {
          setLibraryView('units')
          setReaderOpen(false)
          setEvidenceUnitId(null)
          setUnitSearchFocusKey((value) => value + 1)
        }}
      />

      <main className="knowledge-stage">
        <header className="library-masthead">
          <div className="masthead-title">
            <span>01 / KNOWLEDGE LIBRARY</span>
            <h1>知识库</h1>
            <nav aria-label="知识库视图">
              <button
                aria-pressed={libraryView === 'nodes'}
                onClick={() => selectLibraryView('nodes')}
                type="button"
              >
                长期节点
              </button>
              <button
                aria-pressed={libraryView === 'timeline'}
                onClick={() => selectLibraryView('timeline')}
                type="button"
              >
                内容时间流
              </button>
              <button
                aria-pressed={libraryView === 'units'}
                onClick={() => selectLibraryView('units')}
                type="button"
              >
                单元浏览
              </button>
            </nav>
          </div>
          <p className="masthead-statement">
            {libraryView === 'nodes'
              ? '不是内容的仓库，而是从原始表达中持续归并、修正并保留来源的长期认知。'
              : libraryView === 'timeline'
                ? '沿发布时间阅读每期内容提取出的判断、方法与认知，再按需回到逐字原文。'
                : '跨内容检索每一条逐字证据，以类型、标签和信源定位判断、方法与认知。'}
          </p>
          <div className="masthead-ledger" aria-label="知识库规模">
            <span><strong>{stats.nodes}</strong><small>长期节点</small></span>
            <span><strong>{stats.corroborated}</strong><small>多源佐证</small></span>
            <span><strong>{stats.units}</strong><small>证据单元</small></span>
            <span><strong>{stats.contents}</strong><small>原始内容</small></span>
          </div>
        </header>

        <section className={`library-frame view-${libraryView}`}>
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

          {libraryView === 'nodes' ? (
            <>
              <aside className="library-rail" data-open={filtersOpen}>
            <header>
              <span>INDEX / FILTER</span>
              <button onClick={() => setFiltersOpen(false)} type="button">完成</button>
            </header>

            <section className="rail-section">
              <p>节点类型</p>
              {([
                ['all', '全部知识'],
                ['concept', '认知'],
                ['method', '方法'],
                ['claim', '判断'],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={kind === value}
                  key={value}
                  onClick={() => setKind(value)}
                  type="button"
                >
                  <span>{label}</span><b>{typeCounts[value]}</b>
                </button>
              ))}
            </section>

            <section className="rail-section">
              <p>生命周期</p>
              <button aria-pressed={status === 'all'} onClick={() => setStatus('all')} type="button">
                <span>全部状态</span><b>{nodes.length}</b>
              </button>
              {availableStatuses.map(([value, count]) => (
                <button
                  aria-pressed={status === value}
                  key={value}
                  onClick={() => setStatus(value)}
                  type="button"
                >
                  <span>{statusLabels[value]}</span><b>{count}</b>
                </button>
              ))}
            </section>

            <section className="rail-section rail-topics">
              <p>高频主题</p>
              {popularTags.map(([value, count]) => (
                <button
                  aria-pressed={tag === value}
                  key={value}
                  onClick={() => setTag(tag === value ? null : value)}
                  type="button"
                >
                  <span>{value}</span><b>{count}</b>
                </button>
              ))}
            </section>

            <label className="cross-source-toggle">
              <input
                checked={crossSource}
                onChange={(event) => setCrossSource(event.target.checked)}
                type="checkbox"
              />
              <span><i /></span>
              <b>只看跨信源节点</b>
            </label>

            <footer>
              <span>{stats.creators} 位信源</span>
              <b>PROVENANCE ON</b>
            </footer>
              </aside>

              <section className="node-catalog">
            <header className="catalog-tools">
              <button
                aria-expanded={filtersOpen}
                className="mobile-filter-trigger"
                onClick={() => setFiltersOpen(true)}
                type="button"
              >
                筛选
              </button>
              <label className="catalog-search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="搜索长期知识节点"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索长期知识"
                  ref={searchRef}
                  value={query}
                />
                {query && <button aria-label="清空搜索" onClick={() => setQuery('')} type="button">×</button>}
                <kbd>⌘K</kbd>
              </label>
              <label className="catalog-sort">
                <span>排序</span>
                <select
                  aria-label="节点排序"
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  value={sortMode}
                >
                  <option value="evidence">证据优先</option>
                  <option value="recent">最近演进</option>
                </select>
              </label>
            </header>

            <div className="catalog-state">
              <p aria-live="polite">
                <strong>{visibleNodes.length}</strong>
                <span>个节点</span>
              </p>
              {hasActiveFilters ? (
                <button onClick={resetFilters} type="button">清除当前条件</button>
              ) : (
                <span>按 ↑ ↓ 浏览</span>
              )}
            </div>

            {loadMode === 'preview' && (
              <div className="preview-notice">
                <i />
                <span>后端未连接，当前显示仓库内的真实归并样本。</span>
              </div>
            )}

            <div className="node-list" aria-busy={loadMode === 'loading'}>
              {loadMode === 'loading' && [0, 1, 2, 3].map((item) => (
                <div className="node-row node-row-skeleton" key={item}><i /><span /><span /></div>
              ))}

              {loadMode !== 'loading' && visibleNodes.map((node, index) => {
                const scoreCount = node.hit + node.partial + node.miss
                return (
                  <button
                    aria-pressed={selectedNode?.id === node.id}
                    className={`node-row kind-${node.kind}`}
                    data-node-id={node.id}
                    key={node.id}
                    onClick={() => selectNode(node, true)}
                    onFocus={() => selectNode(node)}
                    onKeyDown={(event) => handleNodeKeyDown(event, index)}
                    type="button"
                  >
                    <span className="node-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="node-row-body">
                      <span className="node-row-meta">
                        <b>{kindLabels[node.kind]}</b>
                        <i />
                        <em>{statusLabels[node.status]}</em>
                      </span>
                      <strong>{node.title}</strong>
                      <span className="node-canonical">{node.canonical}</span>
                      <span className="node-row-foot">
                        <span>{node.n_attest} 次提及</span>
                        <span>{node.n_creators} 位信源</span>
                        <span>{scoreCount ? `${scoreCount} 个评分时点` : '等待验证'}</span>
                      </span>
                    </span>
                  </button>
                )
              })}

              {loadMode !== 'loading' && visibleNodes.length === 0 && (
                <div className="knowledge-empty">
                  <span>NO MATCHED NODE</span>
                  <strong>没有匹配的长期节点</strong>
                  <p>调整检索词或清除筛选条件。</p>
                  <button onClick={resetFilters} type="button">清除全部条件</button>
                </div>
              )}
            </div>
              </section>

              <aside className="node-reader" data-open={readerOpen}>
            <button
              className="reader-close"
              onClick={() => {
                setReaderOpen(false)
                setEvidenceUnitId(null)
              }}
              type="button"
            >
              <span>返回节点索引</span><b>×</b>
            </button>
            {selectedNode && (
              <NodeReader
                detail={detail}
                detailMode={detailMode}
                node={selectedNode}
                onOpenRelated={openRelatedNode}
                onOpenUnit={openEvidenceUnit}
                onRetry={() => setDetailRequestKey((value) => value + 1)}
                position={selectedPosition}
                total={visibleNodes.length}
              />
            )}
            {evidenceUnitId !== null && selectedNode && (
              <EvidenceDossier
                onClose={() => setEvidenceUnitId(null)}
                parentTitle={selectedNode.title}
                unitId={evidenceUnitId}
              />
            )}
              </aside>
            </>
          ) : libraryView === 'timeline' ? (
            <ContentTimeline
              contents={contents}
              evidenceUnitId={evidenceUnitId}
              isLoading={loadMode === 'loading'}
              isPreview={loadMode === 'preview'}
              onCloseEvidence={() => setEvidenceUnitId(null)}
              onCloseReader={() => {
                setReaderOpen(false)
                setEvidenceUnitId(null)
              }}
              onOpenEvidence={openEvidenceUnit}
              onSelectContent={selectContent}
              readerOpen={readerOpen}
              selectedContentId={selectedContentId}
            />
          ) : (
            <UnitBrowser
              creators={creators}
              filtersOpen={filtersOpen}
              focusRequestKey={unitSearchFocusKey}
              initialUnits={units}
              isPreview={loadMode === 'preview'}
              onCloseFilters={() => setFiltersOpen(false)}
              onCloseReader={() => setReaderOpen(false)}
              onOpenFilters={() => setFiltersOpen(true)}
              onSelectUnit={selectBrowseUnit}
              readerOpen={readerOpen}
              selectedUnitId={selectedBrowseUnitId}
            />
          )}
        </section>
      </main>

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
  const firstSeen = formatDate(node.first_seen)
  const lastSeen = formatDate(node.last_seen)

  return (
    <article className={`node-reader-sheet kind-${node.kind}`} key={node.id}>
      <header className="reader-head">
        <span>NODE / {String(node.id).padStart(3, '0')}</span>
        <p><b>{String(position).padStart(2, '0')}</b> / {String(total).padStart(2, '0')}</p>
      </header>

      <div className="reader-status">
        <span><i />{kindLabels[node.kind]}</span>
        <b>{statusLabels[node.status]}</b>
      </div>

      <h2>{node.title}</h2>
      <p className="reader-canonical">{node.canonical}</p>

      <div className="reader-tags">
        {node.tags.map((item) => <span key={item}>{item}</span>)}
      </div>

      <section className="evidence-route">
        <header>
          <p>证据路径</p>
          <span>EVIDENCE ROUTE</span>
        </header>
        <div>
          <span><small>提及</small><strong>{node.n_attest}</strong></span>
          <i />
          <span><small>原始内容</small><strong>{node.n_contents}</strong></span>
          <i />
          <span><small>独立信源</small><strong>{node.n_creators}</strong></span>
        </div>
        {(firstSeen || lastSeen) && (
          <footer>
            <span>{firstSeen ?? '—'}</span><i /><span>{lastSeen ?? firstSeen}</span>
          </footer>
        )}
      </section>

      <section className="reader-note">
        <header>
          <p>归并与演进</p>
          <span>MERGE NOTE</span>
        </header>
        <blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote>
      </section>

      {detailMode === 'loading' && (
        <section className="detail-loading" aria-label="正在读取完整证据">
          <header><span /><b /></header>
          <i /><i /><i />
        </section>
      )}

      {detailMode === 'error' && (
        <section className="detail-error">
          <span>DETAIL UNAVAILABLE</span>
          <strong>完整证据暂时没有载入</strong>
          <p>节点摘要仍可阅读，重试不会改变当前筛选与阅读位置。</p>
          <button onClick={onRetry} type="button">重新读取证据</button>
        </section>
      )}

      {detailMode === 'preview' && (
        <section className="detail-preview">
          <span>PREVIEW DATA</span>
          <p>当前预览样本只包含节点摘要；连接后端后，这里会显示逐条提及与节点关系。</p>
        </section>
      )}

      {detailMode === 'loaded' && detail && (
        <>
          <section className="attestation-timeline">
            <header>
              <div>
                <p>提及与演进</p>
                <span>从早到晚保留每一次重申、细化、修正或反驳</span>
              </div>
              <b>{detail.attestations.length} 条</b>
            </header>

            {detail.attestations.length ? (
              <ol>
                {detail.attestations.map((attestation, index) => (
                  <li key={`${attestation.unit_id}-${index}`}>
                    <div className="timeline-axis">
                      <time>{formatDate(attestation.published_at) ?? '—'}</time>
                      <i />
                    </div>
                    <article className={`attestation-entry relation-${attestation.relation}`}>
                      <header>
                        <span>{attestationLabels[attestation.relation]}</span>
                        <b>{attestation.creator}</b>
                      </header>
                      {attestation.note && <p className="attestation-note">{attestation.note}</p>}
                      <blockquote>{attestation.quote}</blockquote>
                      <footer>
                        <span>{attestation.content_title}</span>
                        <p>
                          <b>单元 #{attestation.unit_id}</b>
                          {attestation.locator && <em>定位 {attestation.locator}</em>}
                        </p>
                      </footer>
                      {attestation.scores.length > 0 && (
                        <div className="attestation-scores" aria-label="该提及的市场判定">
                          {attestation.scores.map((score) => (
                            <span className={`outcome-${score.outcome}`} key={score.id}>
                              <b>{score.horizon_label}</b>
                              <em>{outcomeLabels[score.outcome] ?? score.outcome}</em>
                            </span>
                          ))}
                        </div>
                      )}
                      <button
                        aria-label={`核查证据单元 ${attestation.unit_id}`}
                        className="attestation-open"
                        onClick={() => onOpenUnit(attestation.unit_id)}
                        type="button"
                      >
                        <span>核查证据单元</span>
                        <i>#{attestation.unit_id} →</i>
                      </button>
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="timeline-empty">该节点尚未返回提及记录。</p>
            )}
          </section>

          <section className="node-relations">
            <header>
              <div>
                <p>节点关系</p>
                <span>不强行归并的分歧，以及值得并读的互补命题</span>
              </div>
              <b>{detail.relations.length} 条</b>
            </header>

            {detail.relations.length ? (
              <div className="relation-list">
                {detail.relations.map((relation) => (
                  <button
                    className={`relation-card relation-${relation.relation}`}
                    key={`${relation.relation}-${relation.other_id}`}
                    onClick={() => onOpenRelated(relation.other_id)}
                    type="button"
                  >
                    <span>
                      <b>{relationLabels[relation.relation]}</b>
                      <em>{kindLabels[relation.other_kind]} · {statusLabels[relation.other_status]}</em>
                    </span>
                    <strong>{relation.other_title}</strong>
                    <p>{relation.note}</p>
                    <footer>打开关联节点 <i>→</i></footer>
                  </button>
                ))}
              </div>
            ) : (
              <p className="relation-empty">当前没有经过人工确认的对立或互补关系。</p>
            )}
          </section>
        </>
      )}

      <section className="reader-score">
        <header>
          <p>市场裁决</p>
          <span>{scoreCount ? `${weightedHitRate}% · n=${scoreCount}` : '尚无可计分时点'}</span>
        </header>
        {scoreCount ? (
          <div className="score-segments" aria-label={`命中 ${node.hit}，部分 ${node.partial}，未中 ${node.miss}`}>
            <i style={{ flex: node.hit || 0.001 }} />
            <i style={{ flex: node.partial || 0.001 }} />
            <i style={{ flex: node.miss || 0.001 }} />
          </div>
        ) : (
          <p className="score-pending"><i />没有 0%，只有尚未到期或不可评分。</p>
        )}
      </section>

      <footer className="reader-foot">
        <span>节点会随新证据继续演进</span>
        <b>PROVENANCE INTACT</b>
      </footer>
    </article>
  )
}

export default KnowledgePage
