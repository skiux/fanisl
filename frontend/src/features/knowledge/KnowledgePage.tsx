import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import EvidenceDossier from './EvidenceDossier'
import UnitBrowser from './UnitBrowser'
import { previewNodes } from './preview'
import { previewSourceBundles, previewSourceContents } from './source-preview'
import { creatorInitial, youtubeThumbnail } from './video'
import type {
  AttestationRelation,
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentUnit,
  KnowledgeCreator,
  KnowledgeKind,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeUnitSummary,
  NodeRelationKind,
  NodeStatus,
  UnitScore,
} from './types'
import './knowledge.css'
import './source-workspace.css'

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
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '待复核',
}

const directionLabels: Record<string, string> = {
  up: '↑ 看多',
  down: '↓ 看空',
  flat: '→ 持平',
  range: '↔ 区间',
  vol_up: '波动上升',
  vol_down: '波动下降',
}

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  rss: 'RSS',
  x: 'X',
  telegram: 'Telegram',
  manual: '手动归档',
}

type LoadMode = 'loading' | 'live' | 'preview'
type ReaderMode = 'idle' | 'loading' | 'loaded' | 'error' | 'preview'
type KnowledgeView = 'sources' | 'nodes' | 'evidence'
type KindFilter = 'all' | KnowledgeKind
type SourceWorkspaceView = 'original' | 'units' | 'nodes' | 'verdicts'
type NodeWorkspaceView = 'overview' | 'evidence' | 'verdicts' | 'relations'
type ContentBundle = {
  detail: KnowledgeContentDetail
  units: KnowledgeContentUnit[]
}

type HashState = {
  contentId: number | null
  nodeId: number | null
  view: KnowledgeView
}

function positiveId(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function readHashState(): HashState {
  const query = window.location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const contentId = positiveId(params.get('content'))
  const nodeId = positiveId(params.get('node'))
  const requestedView = params.get('view')
  return {
    contentId,
    nodeId,
    view: nodeId ? 'nodes' : requestedView === 'nodes'
      ? 'nodes'
      : requestedView === 'evidence' || params.get('search') === '1'
        ? 'evidence'
        : 'sources',
  }
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

function compactNumber(value: number) {
  if (!value) return '—'
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function relativePublishedDate(value: string | null | undefined) {
  if (!value) return '日期未知'
  const published = new Date(value)
  const now = new Date()
  const days = Math.floor((now.getTime() - published.getTime()) / 86_400_000)
  if (days >= 0 && days < 1) return '今天'
  if (days === 1) return '昨天'
  if (days > 1 && days < 30) return `${days} 天前`
  if (days >= 30 && days < 365) return `${Math.max(1, Math.floor(days / 30))} 个月前`
  if (days >= 365) return `${Math.floor(days / 365)} 年前`
  return formatDate(value, true)
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asTextArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function unitStatement(unit: KnowledgeContentUnit) {
  if (unit.kind === 'concept') {
    return asText(unit.payload.canonical_statement) ?? '已提取为一条可复用认知'
  }
  if (unit.kind === 'method') {
    return asText(unit.payload.name) ?? asText(unit.payload.summary) ?? '已提取为一条研究方法'
  }
  const asset = asText(unit.payload.asset_text) ?? asText(unit.payload.asset_symbol) ?? '市场判断'
  const direction = asText(unit.payload.direction)
  return direction ? `${asset} · ${directionLabels[direction] ?? direction}` : asset
}

function unitFacts(unit: KnowledgeContentUnit) {
  if (unit.kind === 'claim') {
    const scoring = asRecord(unit.payload.scoring_spec)
    return [
      asText(unit.payload.verifiability) ? `可验证性 ${asText(unit.payload.verifiability)}` : null,
      asText(unit.payload.condition_text),
      scoring ? asText(scoring.success_def) : null,
    ].filter((item): item is string => Boolean(item))
  }
  if (unit.kind === 'method') {
    return [
      asText(unit.payload.summary),
      ...asTextArray(unit.payload.rules).slice(0, 2),
    ].filter((item): item is string => Boolean(item))
  }
  return [
    asText(unit.payload.regime_qualifier),
    asText(unit.payload.category),
  ].filter((item): item is string => Boolean(item))
}

function splitRaw(raw: string) {
  const marker = /\n##\s*视觉笔记[^\n]*\n/i
  const match = marker.exec(raw)
  if (!match || match.index === undefined) return { transcript: raw.trim(), visualNotes: '' }
  return {
    transcript: raw.slice(0, match.index).trim(),
    visualNotes: raw.slice(match.index + match[0].length).trim(),
  }
}

function compareEvidence(a: KnowledgeNode, b: KnowledgeNode) {
  return b.n_attest - a.n_attest || b.n_creators - a.n_creators || a.id - b.id
}

function KnowledgeTrace({ node }: { node: KnowledgeNode }) {
  const count = Math.max(1, Math.min(node.n_attest, 6))
  return (
    <span className="knowledge-trace" aria-label={`${node.n_attest} 次提及`}>
      <span className="trace-dates"><time>{formatDate(node.first_seen)}</time><time>{formatDate(node.last_seen)}</time></span>
      <span className="trace-line" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <i key={index} />)}
      </span>
      <span className="trace-summary"><b>{node.n_attest}</b> 次提及 · <b>{node.n_creators}</b> 位信源</span>
    </span>
  )
}

function KnowledgePage() {
  const initialRef = useRef(readHashState())
  const contentCacheRef = useRef(new Map<number, ContentBundle>())
  const nodeCacheRef = useRef(new Map<number, KnowledgeNodeDetail>())
  const [view, setView] = useState<KnowledgeView>(initialRef.current.view)
  const [contents, setContents] = useState<KnowledgeContentSummary[]>([])
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [creators, setCreators] = useState<KnowledgeCreator[]>([])
  const [loadMode, setLoadMode] = useState<LoadMode>('loading')
  const [contentId, setContentId] = useState<number | null>(initialRef.current.contentId)
  const [contentPayload, setContentPayload] = useState<ContentBundle | null>(null)
  const [contentMode, setContentMode] = useState<ReaderMode>('idle')
  const [contentRequestKey, setContentRequestKey] = useState(0)
  const [nodeId, setNodeId] = useState<number | null>(initialRef.current.nodeId)
  const [nodeDetail, setNodeDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [nodeMode, setNodeMode] = useState<ReaderMode>('idle')
  const [nodeRequestKey, setNodeRequestKey] = useState(0)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [creatorId, setCreatorId] = useState<number | null>(null)
  const [nodeQuery, setNodeQuery] = useState('')
  const [nodeKind, setNodeKind] = useState<KindFilter>('all')
  const [units, setUnits] = useState<KnowledgeUnitSummary[]>([])
  const [unitsLoaded, setUnitsLoaded] = useState(false)
  const [unitMode, setUnitMode] = useState<LoadMode>('loading')
  const [unitFiltersOpen, setUnitFiltersOpen] = useState(false)
  const [unitReaderOpen, setUnitReaderOpen] = useState(false)
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null)
  const [unitFocusKey, setUnitFocusKey] = useState(view === 'evidence' ? 1 : 0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      apiJson<KnowledgeContentSummary[]>('/knowledge/contents?limit=200', { signal: controller.signal }),
      apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal }),
      apiJson<KnowledgeCreator[]>('/knowledge/creators', { signal: controller.signal }),
    ]).then(([contentRows, nodeRows, creatorRows]) => {
      setContents(contentRows)
      setNodes(nodeRows)
      setCreators(creatorRows)
      setLoadMode('live')
    }).catch(() => {
      if (controller.signal.aborted) return
      setContents(previewSourceContents)
      setNodes(previewNodes)
      setCreators([
        { id: 1, name: 'Andy Lee 财经', lang: 'zh', focus: null, notes: null, active: true, created_at: '' },
        { id: 2, name: '美投君', lang: 'zh', focus: null, notes: null, active: true, created_at: '' },
      ])
      setLoadMode('preview')
    })
    return () => controller.abort()
  }, [])

  const selectedContent = contents.find((content) => content.id === contentId) ?? null
  const selectedNode = nodes.find((node) => node.id === nodeId) ?? null

  useEffect(() => {
    if (contentId === null || loadMode === 'loading') {
      setContentPayload(null)
      setContentMode('idle')
      return
    }
    if (!selectedContent) {
      setContentId(null)
      return
    }
    if (loadMode === 'preview') {
      setContentPayload(previewSourceBundles[selectedContent.id] ?? null)
      setContentMode('preview')
      return
    }
    const cached = contentCacheRef.current.get(selectedContent.id)
    if (cached) {
      setContentPayload(cached)
      setContentMode('loaded')
      return
    }
    const controller = new AbortController()
    setContentPayload(null)
    setContentMode('loading')
    Promise.all([
      apiJson<KnowledgeContentDetail>(`/knowledge/contents/${selectedContent.id}`, { signal: controller.signal }),
      apiJson<KnowledgeContentUnit[]>(`/knowledge/contents/${selectedContent.id}/units`, { signal: controller.signal }),
    ]).then(([detail, contentUnits]) => {
      const bundle = { detail, units: contentUnits }
      contentCacheRef.current.set(selectedContent.id, bundle)
      setContentPayload(bundle)
      setContentMode('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setContentMode('error')
    })
    return () => controller.abort()
  }, [contentId, contentRequestKey, loadMode, selectedContent])

  useEffect(() => {
    if (nodeId === null || loadMode === 'loading') {
      setNodeDetail(null)
      setNodeMode('idle')
      return
    }
    if (!selectedNode) {
      setNodeId(null)
      return
    }
    if (loadMode === 'preview') {
      setNodeDetail({ ...selectedNode, attestations: [], relations: [] })
      setNodeMode('preview')
      return
    }
    const cached = nodeCacheRef.current.get(selectedNode.id)
    if (cached) {
      setNodeDetail(cached)
      setNodeMode('loaded')
      return
    }
    const controller = new AbortController()
    setNodeDetail(null)
    setNodeMode('loading')
    apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${selectedNode.id}`, { signal: controller.signal })
      .then((payload) => {
        const complete = { ...selectedNode, ...payload }
        nodeCacheRef.current.set(selectedNode.id, complete)
        setNodeDetail(complete)
        setNodeMode('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setNodeMode('error')
      })
    return () => controller.abort()
  }, [loadMode, nodeId, nodeRequestKey, selectedNode])

  useEffect(() => {
    if (view !== 'evidence' || unitsLoaded || loadMode === 'loading') return
    if (loadMode === 'preview') {
      setUnitMode('preview')
      setUnitsLoaded(true)
      return
    }
    const controller = new AbortController()
    apiJson<KnowledgeUnitSummary[]>('/knowledge/units?limit=500', { signal: controller.signal })
      .then((rows) => {
        setUnits(rows)
        setSelectedUnitId(rows[0]?.id ?? null)
        setUnitMode('live')
        setUnitsLoaded(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setUnitMode('preview')
        setUnitsLoaded(true)
      })
    return () => controller.abort()
  }, [loadMode, unitsLoaded, view])

  useEffect(() => {
    const syncHistory = () => {
      const next = readHashState()
      setView(next.view)
      setContentId(next.contentId)
      setNodeId(next.nodeId)
      setEvidenceUnitId(null)
    }
    window.addEventListener('popstate', syncHistory)
    return () => window.removeEventListener('popstate', syncHistory)
  }, [])

  function switchView(next: KnowledgeView) {
    setView(next)
    setContentId(null)
    setNodeId(null)
    setEvidenceUnitId(null)
    setUnitReaderOpen(false)
    setUnitFiltersOpen(false)
    window.history.pushState(null, '', next === 'sources' ? '#/knowledge' : `#/knowledge?view=${next}`)
    window.scrollTo({ top: 0, left: 0 })
    if (next === 'evidence') setUnitFocusKey((value) => value + 1)
  }

  function openContent(id: number) {
    setView('sources')
    setNodeId(null)
    setContentId(id)
    setEvidenceUnitId(null)
    window.history.pushState({ fanislContent: id }, '', `#/knowledge?content=${id}`)
    window.scrollTo({ top: 0, left: 0 })
  }

  function openNode(id: number) {
    setView('nodes')
    setContentId(null)
    setNodeId(id)
    setEvidenceUnitId(null)
    window.history.pushState({ fanislNode: id }, '', `#/knowledge?node=${id}`)
    window.scrollTo({ top: 0, left: 0 })
  }

  function closeReader() {
    const next = view === 'nodes' ? 'nodes' : 'sources'
    setContentId(null)
    setNodeId(null)
    setEvidenceUnitId(null)
    window.history.replaceState(null, '', next === 'sources' ? '#/knowledge' : '#/knowledge?view=nodes')
    window.scrollTo({ top: 0, left: 0 })
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        switchView('evidence')
        return
      }
      if (event.key !== 'Escape') return
      if (evidenceUnitId !== null) setEvidenceUnitId(null)
      else if (unitFiltersOpen) setUnitFiltersOpen(false)
      else if (unitReaderOpen) setUnitReaderOpen(false)
      else if (contentId !== null || nodeId !== null) closeReader()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  useEffect(() => {
    if (evidenceUnitId === null && !unitFiltersOpen && !unitReaderOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [evidenceUnitId, unitFiltersOpen, unitReaderOpen])

  const visibleContents = useMemo(() => {
    const q = sourceQuery.trim().toLocaleLowerCase()
    return contents.filter((content) => {
      if (creatorId !== null && content.creator_id !== creatorId) return false
      if (!q) return true
      return `${content.title} ${content.creator}`.toLocaleLowerCase().includes(q)
    })
  }, [contents, creatorId, sourceQuery])

  const visibleNodes = useMemo(() => {
    const q = nodeQuery.trim().toLocaleLowerCase()
    return nodes.filter((node) => {
      if (nodeKind !== 'all' && node.kind !== nodeKind) return false
      if (!q) return true
      return `${node.title} ${node.canonical} ${node.tags.join(' ')}`.toLocaleLowerCase().includes(q)
    }).sort(compareEvidence)
  }, [nodeKind, nodeQuery, nodes])

  const headerSearch = () => switchView('evidence')

  if (contentId !== null && selectedContent) {
    return (
      <div className="knowledge-page source-document-page">
        <main className="source-document-stage">
          <SourceDocument
            bundle={contentPayload}
            content={selectedContent}
            isPreview={contentMode === 'preview'}
            mode={contentMode}
            nodes={nodes}
            onClose={closeReader}
            onOpenNode={openNode}
            onOpenUnit={setEvidenceUnitId}
            onRetry={() => setContentRequestKey((value) => value + 1)}
          />
          {evidenceUnitId !== null && contentMode !== 'preview' && (
            <div className="knowledge-evidence-layer">
              <EvidenceDossier
                backLabel="返回本期内容"
                onClose={() => setEvidenceUnitId(null)}
                parentLabel="CONTENT"
                parentTitle={selectedContent.title}
                unitId={evidenceUnitId}
              />
            </div>
          )}
        </main>
      </div>
    )
  }

  if (nodeId !== null && selectedNode) {
    return (
      <div className="knowledge-page node-document-page">
        <main className="node-document-stage">
          <NodeDocument
            detail={nodeDetail}
            mode={nodeMode}
            node={selectedNode}
            onClose={closeReader}
            onOpenNode={openNode}
            onOpenUnit={setEvidenceUnitId}
            onRetry={() => setNodeRequestKey((value) => value + 1)}
          />
          {evidenceUnitId !== null && nodeMode !== 'preview' && (
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

  if (view === 'evidence') {
    return (
      <div className="knowledge-page knowledge-evidence-page">
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="evidence-search-stage">
          <header className="utility-lead">
            <button onClick={() => switchView('sources')} type="button">← 返回原始内容</button>
            <div><span>EVIDENCE / SEARCH</span><h1>逐字证据</h1></div>
            <p>跨内容检索判断、方法与认知。结果直接落到原文引文和冻结判据，不把搜索结果伪装成长期结论。</p>
          </header>
          <section className="evidence-search-frame">
            <button
              aria-label="关闭当前面板"
              className="frame-backdrop"
              data-open={unitFiltersOpen || unitReaderOpen}
              onClick={() => { setUnitFiltersOpen(false); setUnitReaderOpen(false) }}
              type="button"
            />
            <UnitBrowser
              creators={creators}
              filtersOpen={unitFiltersOpen}
              focusRequestKey={unitFocusKey}
              initialUnits={units}
              isPreview={unitMode === 'preview'}
              onCloseFilters={() => setUnitFiltersOpen(false)}
              onCloseReader={() => setUnitReaderOpen(false)}
              onOpenFilters={() => setUnitFiltersOpen(true)}
              onSelectUnit={(id, open) => { setSelectedUnitId(id); if (open) setUnitReaderOpen(true) }}
              readerOpen={unitReaderOpen}
              selectedUnitId={selectedUnitId}
            />
          </section>
        </main>
      </div>
    )
  }

  if (view === 'nodes') {
    return (
      <div className="knowledge-page node-library-page">
        <div aria-hidden="true" className="knowledge-material" />
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <NodeLibrary
          kind={nodeKind}
          loadMode={loadMode}
          nodes={nodes}
          onChangeKind={setNodeKind}
          onChangeQuery={setNodeQuery}
          onOpenNode={openNode}
          onShowSources={() => switchView('sources')}
          query={nodeQuery}
          visibleNodes={visibleNodes}
        />
      </div>
    )
  }

  return (
    <div className="knowledge-page source-library-page">
      <div aria-hidden="true" className="knowledge-material" />
      <AppHeader current="knowledge" onSearch={headerSearch} />
      <SourceLibrary
        contents={contents}
        creatorId={creatorId}
        creators={creators}
        loadMode={loadMode}
        nodes={nodes}
        onChangeCreator={setCreatorId}
        onChangeQuery={setSourceQuery}
        onOpenContent={openContent}
        onShowEvidence={() => switchView('evidence')}
        onShowNodes={() => switchView('nodes')}
        query={sourceQuery}
        visibleContents={visibleContents}
      />
    </div>
  )
}

function SourceLibrary({
  contents,
  creatorId,
  creators,
  loadMode,
  nodes,
  onChangeCreator,
  onChangeQuery,
  onOpenContent,
  onShowEvidence,
  onShowNodes,
  query,
  visibleContents,
}: {
  contents: KnowledgeContentSummary[]
  creatorId: number | null
  creators: KnowledgeCreator[]
  loadMode: LoadMode
  nodes: KnowledgeNode[]
  onChangeCreator: (id: number | null) => void
  onChangeQuery: (value: string) => void
  onOpenContent: (id: number) => void
  onShowEvidence: () => void
  onShowNodes: () => void
  query: string
  visibleContents: KnowledgeContentSummary[]
}) {
  const totals = contents.reduce((acc, content) => ({
    raw: acc.raw + content.raw_len,
    units: acc.units + content.n_units,
    scores: acc.scores + content.n_hit + content.n_partial + content.n_miss,
  }), { raw: 0, units: 0, scores: 0 })

  return (
    <main className="source-library-stage">
      <header className="source-library-lead">
        <div>
          <span>KNOWLEDGE LIBRARY</span>
          <h1>内容</h1>
          <p>从每一期视频进入，阅读原文、知识提取与后续裁决。</p>
        </div>
        <div className="source-lead-actions">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="搜索内容"
              onChange={(event) => onChangeQuery(event.target.value)}
              placeholder="搜索视频标题或创作者"
              value={query}
            />
            {query && <button aria-label="清空搜索" onClick={() => onChangeQuery('')} type="button">×</button>}
          </label>
          <button onClick={onShowNodes} type="button">长期知识</button>
          <button onClick={onShowEvidence} type="button">逐字证据</button>
        </div>
      </header>

      {loadMode === 'preview' && (
        <div className="preview-notice"><i /><span>后端未连接，当前显示仓库内的真实内容样本。</span></div>
      )}

      <section className="video-library">
        <div className="video-library-tabs" aria-label="按信源筛选">
          <button aria-pressed={creatorId === null} onClick={() => onChangeCreator(null)} type="button">全部信源 <small>{contents.length}</small></button>
          {creators.map((creator) => {
            const count = contents.filter((content) => content.creator_id === creator.id).length
            if (!count) return null
            return <button aria-pressed={creatorId === creator.id} key={creator.id} onClick={() => onChangeCreator(creator.id)} type="button">{creator.name} <small>{count}</small></button>
          })}
        </div>

        <header className="video-library-heading">
          <h2>{query ? `“${query}”的结果` : creatorId ? creators.find((creator) => creator.id === creatorId)?.name : '全部视频'}</h2>
          <p>{visibleContents.length} 期</p>
        </header>

        <div className="video-grid" aria-busy={loadMode === 'loading'}>
          {loadMode === 'loading' && Array.from({ length: 8 }, (_, item) => <div className="video-card video-card-skeleton" key={item}><i /><span /><span /></div>)}
          {loadMode !== 'loading' && visibleContents.map((content) => {
            const thumbnail = youtubeThumbnail(content.url)
            const scored = content.n_hit + content.n_partial + content.n_miss
            return (
              <article className="video-card" key={content.id}>
                <button aria-label={`打开内容：${content.title}`} className="video-thumbnail" onClick={() => onOpenContent(content.id)} type="button">
                  {thumbnail ? (
                    <img
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        const image = event.currentTarget
                        if (image.dataset.fallback === 'true') return
                        image.dataset.fallback = 'true'
                        image.src = youtubeThumbnail(content.url, 'medium') ?? ''
                      }}
                      src={thumbnail}
                    />
                  ) : <span aria-hidden="true" className="video-thumbnail-fallback" />}
                  <span className="video-card-badges">
                    <b>{content.n_units} 个知识单元</b>
                    {scored > 0 && <b>{scored} 个裁决</b>}
                  </span>
                  <span className="video-card-play" aria-hidden="true">▶</span>
                </button>
                <div className="video-card-copy">
                  <span className={`creator-avatar creator-${content.creator_id}`}>{creatorInitial(content.creator)}</span>
                  <div>
                    <button onClick={() => onOpenContent(content.id)} type="button"><strong>{content.title}</strong></button>
                    <p>{content.creator}</p>
                    <p>{relativePublishedDate(content.published_at)} · {content.n_claims} 判断 · {content.n_methods} 方法 · {content.n_concepts} 认知</p>
                  </div>
                </div>
              </article>
            )
          })}
          {loadMode !== 'loading' && visibleContents.length === 0 && (
            <div className="source-empty"><span>NO MATCHED VIDEO</span><strong>没有匹配的视频内容</strong><button onClick={() => { onChangeQuery(''); onChangeCreator(null) }} type="button">清除条件</button></div>
          )}
        </div>
      </section>

      <section className="source-library-summary">
        <div><strong>{contents.length}</strong><span>收录内容</span></div>
        <div><strong>{compactNumber(totals.raw)}</strong><span>原文总字数</span></div>
        <div><strong>{totals.units}</strong><span>提取单元</span></div>
        <div><strong>{nodes.length}</strong><span>长期知识</span></div>
        <div><strong>{totals.scores}</strong><span>到期裁决</span></div>
      </section>

      <footer className="knowledge-footer"><span>FANISL / SOURCE PRESERVED</span><p>原文不可变，结论可以随新证据继续修正。</p></footer>
    </main>
  )
}

function SourceDocument({
  bundle,
  content,
  isPreview,
  mode,
  nodes,
  onClose,
  onOpenNode,
  onOpenUnit,
  onRetry,
}: {
  bundle: ContentBundle | null
  content: KnowledgeContentSummary
  isPreview: boolean
  mode: ReaderMode
  nodes: KnowledgeNode[]
  onClose: () => void
  onOpenNode: (id: number) => void
  onOpenUnit: (id: number) => void
  onRetry: () => void
}) {
  const [kind, setKind] = useState<KindFilter>('all')
  const [activeView, setActiveView] = useState<SourceWorkspaceView>('original')
  const viewScrollRef = useRef<HTMLDivElement>(null)
  const units = bundle?.units ?? []
  const visibleUnits = kind === 'all' ? units : units.filter((unit) => unit.kind === kind)
  const scoreEntries = units.flatMap((unit) => unit.scores.map((score) => ({ score, unit })))
  const topicCount = new Map<string, number>()
  units.forEach((unit) => unit.tags.forEach((tag) => topicCount.set(tag, (topicCount.get(tag) ?? 0) + 1)))
  const relatedNodes = nodes.map((node) => ({
    node,
    weight: node.tags.reduce((sum, tag) => sum + (topicCount.get(tag) ?? 0), 0),
  })).filter((item) => item.weight > 0).sort((a, b) => b.weight - a.weight || compareEvidence(a.node, b.node)).slice(0, 5)
  const raw = bundle ? splitRaw(bundle.detail.raw) : null

  useEffect(() => {
    setActiveView('original')
    setKind('all')
  }, [content.id])

  useEffect(() => {
    viewScrollRef.current?.scrollTo({ top: 0 })
  }, [activeView, kind])

  if (mode === 'loading' || mode === 'idle') return <SourceReaderSkeleton content={content} />
  if (mode === 'error' || !bundle || !raw) {
    return <div className="reader-error"><span>CONTENT UNAVAILABLE</span><strong>这期原始内容暂时没有载入</strong><p>来源索引仍可使用，重试不会改变内容记录。</p><button onClick={onRetry} type="button">重新读取</button></div>
  }

  return (
    <article className="source-workspace">
      <header className="source-workspace-head">
        <button className="source-workspace-back" onClick={onClose} type="button">← 内容库</button>
        <div className="source-workspace-title">
          <h1>{content.title}</h1>
          <p>CONTENT / {String(content.id).padStart(3, '0')} · {content.creator} · {formatDate(content.published_at, true)}</p>
        </div>
        <div className="source-workspace-actions">
          <a href="#entry">FANISL</a>
          {content.url && <a className="source-external-link" href={content.url} rel="noreferrer" target="_blank">原始视频 ↗</a>}
        </div>
      </header>

      <div className="source-workspace-body">
        <aside className="source-context-pane">
          {youtubeThumbnail(content.url) && (
            <a className="source-context-media" href={content.url ?? undefined} rel="noreferrer" target="_blank">
              <img
                alt={`${content.title} 视频缩略图`}
                onError={(event) => {
                  const image = event.currentTarget
                  if (image.dataset.fallback === 'true') return
                  image.dataset.fallback = 'true'
                  image.src = youtubeThumbnail(content.url, 'medium') ?? ''
                }}
                src={youtubeThumbnail(content.url) ?? ''}
              />
              <span aria-hidden="true">▶</span>
            </a>
          )}
          <div className="source-context-identity"><b>{platformLabels[content.platform] ?? content.platform}</b><span>{content.status === 'extracted' ? '已完成提取' : '等待提取'}</span></div>
          <nav aria-label="内容研究视图" className="source-view-tabs" role="tablist">
            {([
              ['original', '原始内容', `${compactNumber(raw.transcript.length)} 字`],
              ['units', '提取单元', `${units.length} 条`],
              ['nodes', '长期知识', `${relatedNodes.length} 条`],
              ['verdicts', '市场裁决', `${scoreEntries.length} 条`],
            ] as const).map(([value, label, count]) => (
              <button aria-selected={activeView === value} key={value} onClick={() => setActiveView(value)} role="tab" type="button"><span>{label}</span><b>{count}</b></button>
            ))}
          </nav>
          <dl className="source-context-stats">
            <div><dt>原文</dt><dd>{compactNumber(content.raw_len)} 字</dd></div>
            <div><dt>提取</dt><dd>{content.n_units} 单元</dd></div>
            <div><dt>结构</dt><dd>{content.n_claims} / {content.n_methods} / {content.n_concepts}</dd></div>
            <div><dt>裁决</dt><dd>{scoreEntries.length || '等待到期'}</dd></div>
          </dl>
          <div className="source-context-legend" aria-label="知识单元构成">
            <span style={{ flex: content.n_claims || .001 }}><i />{content.n_claims} 判断</span>
            <span style={{ flex: content.n_methods || .001 }}><i />{content.n_methods} 方法</span>
            <span style={{ flex: content.n_concepts || .001 }}><i />{content.n_concepts} 认知</span>
          </div>
          {isPreview && <div className="source-workspace-notice">离线预览仅包含已核对的原文节选和部分提取单元。</div>}
        </aside>

        <section className="source-research-pane">
          <div className="source-view-scroll" ref={viewScrollRef} role="tabpanel">
            {activeView === 'original' && (
              <section className="source-original-view">
                <header><div><span>L0 / IMMUTABLE SOURCE</span><h2>逐字原文</h2></div><p>原始表达不被覆盖；提取和裁决必须能回到这里。</p></header>
                <article>{raw.transcript}</article>
                {raw.visualNotes && <section className="source-visual-notes"><span>画面信息与图表笔记</span><p>{raw.visualNotes}</p></section>}
              </section>
            )}

            {activeView === 'units' && (
              <section className="source-units-view">
                <header className="source-view-heading"><div><span>L1 / EXTRACTION</span><h2>提取单元</h2></div><p>每个单元保留原句和发布时冻结的口径。</p></header>
                <div className="source-unit-filters">
                  {(['all', 'claim', 'method', 'concept'] as const).map((value) => (
                    <button aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">
                      {value === 'all' ? '全部' : kindLabels[value]}
                      <small>{value === 'all' ? units.length : units.filter((unit) => unit.kind === value).length}</small>
                    </button>
                  ))}
                </div>
                <div className="source-unit-list">
                  {visibleUnits.map((unit, index) => (
                    <button className={`source-unit-row kind-${unit.kind}`} disabled={isPreview} key={unit.id} onClick={() => onOpenUnit(unit.id)} type="button">
                      <span className="source-unit-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="source-unit-copy">
                        <span><b>{kindLabels[unit.kind]}</b><time>{unit.locator ?? `#${unit.id}`}</time></span>
                        <strong>{unitStatement(unit)}</strong>
                        <blockquote>{unit.quote}</blockquote>
                        {unitFacts(unit).map((fact, factIndex) => <em key={`${factIndex}-${fact}`}>{fact}</em>)}
                        <span className="source-unit-tags">{unit.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
                        {unit.kind === 'claim' && <UnitScores scores={unit.scores} />}
                      </span>
                      <span className="source-row-arrow">{isPreview ? '节选' : '核查 ↗'}</span>
                    </button>
                  ))}
                  {!visibleUnits.length && <p className="section-empty">本期没有这一类提取单元。</p>}
                </div>
              </section>
            )}

            {activeView === 'nodes' && (
              <section className="source-nodes-view">
                <header className="source-view-heading"><div><span>L3 / CANONICAL KNOWLEDGE</span><h2>同主题的长期知识</h2></div><p>共同标签只用于发现路径，具体归并仍以提及关系为准。</p></header>
                <div className="source-node-list">
                  {relatedNodes.map(({ node }, index) => (
                    <button key={node.id} onClick={() => onOpenNode(node.id)} type="button">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div><p><b>{kindLabels[node.kind]}</b><em>{statusLabels[node.status]}</em></p><strong>{node.title}</strong><blockquote>{node.canonical}</blockquote></div>
                      <i>{node.n_attest} 次提及 ↗</i>
                    </button>
                  ))}
                  {!relatedNodes.length && <p className="section-empty">当前还没有与本期主题相接的长期知识。新内容归并后，这里会形成继续阅读的路径。</p>}
                </div>
              </section>
            )}

            {activeView === 'verdicts' && (
              <section className="source-verdicts-view">
                <header className="source-view-heading"><div><span>L2 / MARKET VERDICT</span><h2>市场裁决</h2></div><p>只显示按照发布时冻结判据机械执行的结果。</p></header>
                <div className="source-workspace-verdicts">
                  {scoreEntries.map(({ score, unit }, index) => (
                    <button className={`outcome-${score.outcome}`} disabled={isPreview} key={`${unit.id}-${score.horizon_label}-${index}`} onClick={() => onOpenUnit(unit.id)} type="button">
                      <span>{outcomeLabels[score.outcome] ?? score.outcome}</span><time>{score.horizon_label}</time><strong>{unitStatement(unit)}</strong><p>{unit.quote}</p><i>{isPreview ? '预览结果' : '核查 ↗'}</i>
                    </button>
                  ))}
                  {!scoreEntries.length && <div className="source-pending-state"><span>WAITING FOR MATURITY</span><strong>判断尚未到达裁决时点</strong><p>没有提前汇总的命中率；冻结判据到期后，结果才会出现在这里。</p></div>}
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </article>
  )
}

function UnitScores({ scores }: { scores: UnitScore[] }) {
  if (!scores.length) return <div className="unit-scores is-pending">评分待到期</div>
  return <div className="unit-scores">{scores.map((score, index) => <span className={`outcome-${score.outcome}`} key={`${score.horizon_label}-${index}`}><b>{score.horizon_label}</b>{outcomeLabels[score.outcome] ?? score.outcome}</span>)}</div>
}

function SourceReaderSkeleton({ content }: { content: KnowledgeContentSummary }) {
  return <article className="source-workspace source-reader-skeleton"><span>CONTENT / {String(content.id).padStart(3, '0')}</span><h1>{content.title}</h1><i /><i /><i /><i /></article>
}

function NodeLibrary({
  kind,
  loadMode,
  nodes,
  onChangeKind,
  onChangeQuery,
  onOpenNode,
  onShowSources,
  query,
  visibleNodes,
}: {
  kind: KindFilter
  loadMode: LoadMode
  nodes: KnowledgeNode[]
  onChangeKind: (kind: KindFilter) => void
  onChangeQuery: (value: string) => void
  onOpenNode: (id: number) => void
  onShowSources: () => void
  query: string
  visibleNodes: KnowledgeNode[]
}) {
  const pageSize = 8
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(visibleNodes[0]?.id ?? null)
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    visibleNodes.forEach((node) => node.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
  }, [visibleNodes])
  const taggedNodes = activeTag ? visibleNodes.filter((node) => node.tags.includes(activeTag)) : visibleNodes
  const pageCount = Math.max(1, Math.ceil(taggedNodes.length / pageSize))
  const pageNodes = taggedNodes.slice(page * pageSize, (page + 1) * pageSize)
  const selectedNode = taggedNodes.find((node) => node.id === selectedId) ?? pageNodes[0] ?? taggedNodes[0] ?? null

  useEffect(() => {
    setPage(0)
  }, [activeTag, kind, query])

  useEffect(() => {
    if (!taggedNodes.some((node) => node.id === selectedId)) setSelectedId(taggedNodes[0]?.id ?? null)
  }, [selectedId, taggedNodes])

  useEffect(() => {
    if (!selectedNode) return
    const index = taggedNodes.findIndex((node) => node.id === selectedNode.id)
    const selectedPage = Math.max(0, Math.floor(index / pageSize))
    if (selectedPage !== page && !pageNodes.some((node) => node.id === selectedNode.id)) setSelectedId(pageNodes[0]?.id ?? null)
  }, [page, pageNodes, selectedNode, taggedNodes])

  return (
    <main className="node-library-stage">
      <header className="node-library-lead">
        <button onClick={onShowSources} type="button">← 回到原始内容</button>
        <div><span>KNOWLEDGE / SETTLED</span><h1>长期知识 <small>{nodes.length}</small></h1></div>
        <p>按主题浏览归并后的认知。左侧定位知识，右侧先判断其结论、证据密度和生命周期，再进入完整证据链。</p>
      </header>
      {loadMode === 'preview' && <div className="preview-notice"><i /><span>后端未连接，当前显示仓库内的真实归并样本。</span></div>}
      <section className="node-workbench">
        <section className="node-browser-panel">
          <header className="node-browser-tools">
            <label><span aria-hidden="true">⌕</span><input aria-label="搜索长期知识" onChange={(event) => onChangeQuery(event.target.value)} placeholder="搜索主题、标的或结论" value={query} />{query && <button onClick={() => onChangeQuery('')} type="button">×</button>}</label>
            <div className="node-kind-switch">
              {(['all', 'concept', 'method', 'claim'] as const).map((value) => <button aria-pressed={kind === value} key={value} onClick={() => onChangeKind(value)} type="button">{value === 'all' ? '全部' : kindLabels[value]} <small>{value === 'all' ? nodes.length : nodes.filter((node) => node.kind === value).length}</small></button>)}
            </div>
            <div className="node-tag-switch" aria-label="热门主题">
              <button aria-pressed={activeTag === null} onClick={() => setActiveTag(null)} type="button">全部主题</button>
              {popularTags.map(([tag, count]) => <button aria-pressed={activeTag === tag} key={tag} onClick={() => setActiveTag(tag)} type="button">{tag} <small>{count}</small></button>)}
            </div>
          </header>
          <div className="node-list" aria-busy={loadMode === 'loading'}>
            {loadMode === 'loading' && [0, 1, 2, 3].map((item) => <div className="node-row node-row-skeleton" key={item}><i /><span /><span /></div>)}
            {loadMode !== 'loading' && pageNodes.map((node, index) => (
              <button aria-current={selectedNode?.id === node.id} className={`node-row kind-${node.kind}`} key={node.id} onClick={() => setSelectedId(node.id)} type="button">
                <span className="node-row-index">{String(page * pageSize + index + 1).padStart(3, '0')}</span>
                <span className="node-row-copy"><span><b>{kindLabels[node.kind]}</b><em>{statusLabels[node.status]}</em></span><strong>{node.title}</strong><p>{node.canonical}</p><small>{node.n_attest} 次提及 · {node.n_creators} 位信源</small></span>
              </button>
            ))}
            {loadMode !== 'loading' && !pageNodes.length && <div className="node-browser-empty"><strong>没有匹配的长期知识</strong><p>清除搜索或主题条件后重新浏览。</p></div>}
          </div>
          <footer className="node-pagination">
            <p><b>{taggedNodes.length}</b> 条结果 · 第 {page + 1} / {pageCount} 页</p>
            <div><button aria-label="上一页" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} type="button">←</button><button aria-label="下一页" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} type="button">→</button></div>
          </footer>
        </section>

        <article className={`node-preview${selectedNode ? ` kind-${selectedNode.kind}` : ''}`}>
          {selectedNode ? (
            <>
              <header><div><span>KNOWLEDGE / {String(selectedNode.id).padStart(3, '0')}</span><b>{kindLabels[selectedNode.kind]} · {statusLabels[selectedNode.status]}</b></div><p>{formatDate(selectedNode.first_seen, true)} — {formatDate(selectedNode.last_seen, true)}</p></header>
              <div className="node-preview-scroll">
                <h2>{selectedNode.title}</h2>
                <blockquote>{selectedNode.canonical}</blockquote>
                <dl><div><dt>提及</dt><dd>{selectedNode.n_attest}</dd></div><div><dt>原始内容</dt><dd>{selectedNode.n_contents}</dd></div><div><dt>独立信源</dt><dd>{selectedNode.n_creators}</dd></div><div><dt>到期裁决</dt><dd>{selectedNode.hit + selectedNode.partial + selectedNode.miss || '—'}</dd></div></dl>
                <section><span>归并说明</span><p>{selectedNode.notes || '当前节点仍处于初始归并阶段，后续证据将继续修正其规范表述。'}</p></section>
                <div className="node-preview-tags">{selectedNode.tags.map((tag) => <button key={tag} onClick={() => setActiveTag(tag)} type="button">{tag}</button>)}</div>
              </div>
              <footer><KnowledgeTrace node={selectedNode} /><button onClick={() => onOpenNode(selectedNode.id)} type="button">阅读完整证据链 ↗</button></footer>
            </>
          ) : <div className="node-preview-empty"><span>NO KNOWLEDGE SELECTED</span><strong>从左侧选择一条长期知识</strong></div>}
        </article>
      </section>
    </main>
  )
}

function NodeDocument({
  detail,
  mode,
  node,
  onClose,
  onOpenNode,
  onOpenUnit,
  onRetry,
}: {
  detail: KnowledgeNodeDetail | null
  mode: ReaderMode
  node: KnowledgeNode
  onClose: () => void
  onOpenNode: (id: number) => void
  onOpenUnit: (id: number) => void
  onRetry: () => void
}) {
  const [activeView, setActiveView] = useState<NodeWorkspaceView>('overview')
  const viewRef = useRef<HTMLDivElement>(null)
  const scoreCount = node.hit + node.partial + node.miss
  const hitRate = scoreCount ? Math.round(((node.hit + node.partial * .5) / scoreCount) * 100) : null
  useEffect(() => {
    setActiveView('overview')
  }, [node.id])
  useEffect(() => {
    viewRef.current?.scrollTo({ top: 0 })
  }, [activeView])
  return (
    <article className={`node-document kind-${node.kind}`}>
      <header className="node-workspace-head"><button onClick={onClose} type="button">← 长期知识</button><div><span>KNOWLEDGE / {String(node.id).padStart(3, '0')}</span><strong>{node.title}</strong></div><a href="#entry">FANISL</a></header>
      <div className="node-workspace-body">
        <aside className="node-document-lead">
          <div><span>{kindLabels[node.kind]}</span><b>{statusLabels[node.status]}</b></div>
          <h1>{node.title}</h1><p>{node.canonical}</p>
          <span className="node-document-tags">{node.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
          <dl><div><dt>提及</dt><dd>{node.n_attest}</dd></div><div><dt>原始内容</dt><dd>{node.n_contents}</dd></div><div><dt>独立信源</dt><dd>{node.n_creators}</dd></div><div><dt>时间跨度</dt><dd>{formatDate(node.first_seen)} — {formatDate(node.last_seen)}</dd></div></dl>
        </aside>
        <section className="node-research-pane">
          <nav aria-label="长期知识研究视图" role="tablist">
            {([
              ['overview', '归并说明', '01'],
              ['evidence', '原始证据', String(detail?.attestations.length ?? node.n_attest)],
              ['verdicts', '市场裁决', String(scoreCount)],
              ['relations', '关联知识', String(detail?.relations.length ?? 0)],
            ] as const).map(([value, label, count]) => <button aria-selected={activeView === value} key={value} onClick={() => setActiveView(value)} role="tab" type="button"><span>{label}</span><b>{count}</b></button>)}
          </nav>
          <div className="node-research-scroll" ref={viewRef} role="tabpanel">
            {activeView === 'overview' && <section className="node-document-section node-overview"><header><span>01 / SYNTHESIS</span><h2>这条知识如何形成</h2><p>规范表述随新证据演进，但保留每一次来源与修正。</p></header><blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote><KnowledgeTrace node={node} /></section>}
            {activeView === 'evidence' && <section className="node-document-section node-attestations"><header><span>02 / PROVENANCE</span><h2>从哪些原始内容形成</h2><p>逐条回到发布时的原句和上下文，不只保留归并后的摘要。</p></header><div>
              {mode === 'loading' && <p className="section-empty">正在读取完整提及链…</p>}
              {mode === 'error' && <p className="section-empty">完整提及链暂时没有载入。 <button onClick={onRetry} type="button">重新读取</button></p>}
              {mode === 'preview' && <p className="section-empty">预览样本只包含节点摘要；连接后端后会显示完整原文提及链。</p>}
              {mode === 'loaded' && detail?.attestations.map((item, index) => <article key={`${item.unit_id}-${index}`}><aside><time>{formatDate(item.published_at, true)}</time><b>{attestationLabels[item.relation]}</b></aside><div><span>{item.creator} · {item.content_title}</span><blockquote>{item.quote}</blockquote>{item.note && <p>{item.note}</p>}<button onClick={() => onOpenUnit(item.unit_id)} type="button">核查逐字证据 #{item.unit_id} ↗</button></div></article>)}
              {mode === 'loaded' && detail?.attestations.length === 0 && <p className="section-empty">该节点尚未返回提及记录。</p>}
            </div></section>}
            {activeView === 'verdicts' && <section className="node-document-section node-verdict"><header><span>03 / VERDICT</span><h2>市场裁决</h2><p>评分只基于发布时冻结的规则，不用事后解释替代结果。</p></header>{hitRate === null ? <p className="section-empty">尚未形成足够的到期评分，不显示 0%。</p> : <div><strong>{hitRate}%</strong><span>加权命中率 · n={scoreCount}</span><p>命中 {node.hit} · 部分 {node.partial} · 未中 {node.miss}</p></div>}</section>}
            {activeView === 'relations' && <section className="node-document-section node-relations"><header><span>04 / RELATIONS</span><h2>继续阅读</h2><p>只展示经过确认的互补或对立关系。</p></header><div>{mode === 'loaded' && detail?.relations.map((relation) => <button key={`${relation.relation}-${relation.other_id}`} onClick={() => onOpenNode(relation.other_id)} type="button"><span>{relationLabels[relation.relation]}</span><strong>{relation.other_title}</strong><p>{relation.note}</p><i>打开节点 ↗</i></button>)}{mode === 'loaded' && detail?.relations.length === 0 && <p className="section-empty">当前没有经过人工确认的对立或互补关系。</p>}</div></section>}
          </div>
        </section>
      </div>
    </article>
  )
}

export default KnowledgePage
