import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import EvidenceDossier from './EvidenceDossier'
import UnitBrowser from './UnitBrowser'
import { previewNodes } from './preview'
import { previewSourceBundles, previewSourceContents } from './source-preview'
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

function dateParts(value: string | null | undefined) {
  if (!value) return { day: '—', month: '日期未知', year: '—' }
  const date = new Date(value)
  return {
    day: new Intl.DateTimeFormat('zh-CN', { day: '2-digit', timeZone: 'Asia/Shanghai' }).format(date),
    month: new Intl.DateTimeFormat('zh-CN', { month: 'short', timeZone: 'Asia/Shanghai' }).format(date),
    year: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(date),
  }
}

function compactNumber(value: number) {
  if (!value) return '—'
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
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
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="source-document-stage">
          <button className="reader-back" onClick={closeReader} type="button">← 返回原始内容</button>
          <SourceDocument
            bundle={contentPayload}
            content={selectedContent}
            isPreview={contentMode === 'preview'}
            mode={contentMode}
            nodes={nodes}
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
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="node-document-stage">
          <button className="reader-back" onClick={closeReader} type="button">← 返回长期知识</button>
          <NodeDocument
            detail={nodeDetail}
            mode={nodeMode}
            node={selectedNode}
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
  const featured = visibleContents[0] ?? contents[0] ?? null
  const totals = contents.reduce((acc, content) => ({
    raw: acc.raw + content.raw_len,
    units: acc.units + content.n_units,
    scores: acc.scores + content.n_hit + content.n_partial + content.n_miss,
  }), { raw: 0, units: 0, scores: 0 })

  return (
    <main className="source-library-stage">
      <header className="source-library-lead">
        <div className="source-lead-title">
          <span>KNOWLEDGE / ORIGIN FIRST</span>
          <h1>从原始内容<br />开始。</h1>
        </div>
        <div className="source-lead-copy">
          <p>先保留谁在什么时候说了什么，再从逐字原文中提取判断、方法与认知。知识不是入口处的结论，而是证据经过时间后留下的形状。</p>
          <div><b>{contents.length}</b> 期内容 <i /> <b>{compactNumber(totals.raw)}</b> 字原文</div>
        </div>
      </header>

      <section className="knowledge-flow" aria-label="知识形成顺序">
        <div className="is-current"><span>01</span><b>原始内容</b><p>{contents.length || '—'} 期不可变来源</p></div>
        <div><span>02</span><b>结构化单元</b><p>{totals.units || '—'} 条判断、方法与认知</p></div>
        <div><span>03</span><b>长期知识</b><p>{nodes.length || '—'} 个归并节点</p></div>
        <div><span>04</span><b>市场裁决</b><p>{totals.scores || '—'} 个有效时点</p></div>
      </section>

      {loadMode === 'preview' && (
        <div className="preview-notice"><i /><span>后端未连接，当前以仓库内的真实内容样本展示来源优先的阅读顺序。</span></div>
      )}

      {loadMode === 'loading' ? (
        <section className="featured-source source-skeleton"><i /><span /><span /><span /></section>
      ) : featured && (
        <section className="featured-source">
          <header>
            <span>LATEST INTAKE</span>
            <p>{formatDate(featured.published_at, true)}</p>
          </header>
          <div className="featured-source-main">
            <p><b>{featured.creator}</b><span>{platformLabels[featured.platform] ?? featured.platform}</span></p>
            <h2>{featured.title}</h2>
            <div className="featured-distribution">
              <span style={{ flex: featured.n_claims || .001 }}><i />{featured.n_claims} 判断</span>
              <span style={{ flex: featured.n_methods || .001 }}><i />{featured.n_methods} 方法</span>
              <span style={{ flex: featured.n_concepts || .001 }}><i />{featured.n_concepts} 认知</span>
            </div>
            <button onClick={() => onOpenContent(featured.id)} type="button">进入这期内容 <i>↗</i></button>
          </div>
          <aside>
            <span>为什么从这里开始</span>
            <p>标题、发布时间、完整转录和画面笔记构成不可变的 L0。后续提取、归并和评分都必须能回到这里。</p>
            <dl>
              <div><dt>原文字数</dt><dd>{compactNumber(featured.raw_len)}</dd></div>
              <div><dt>提取单元</dt><dd>{featured.n_units}</dd></div>
              <div><dt>已裁决</dt><dd>{featured.n_hit + featured.n_partial + featured.n_miss || '待到期'}</dd></div>
            </dl>
          </aside>
        </section>
      )}

      <section className="source-archive">
        <header className="source-archive-head">
          <div><span>SOURCE ARCHIVE</span><h2>全部原始内容</h2></div>
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="搜索原始内容"
              onChange={(event) => onChangeQuery(event.target.value)}
              placeholder="搜索标题或信源"
              value={query}
            />
            {query && <button aria-label="清空搜索" onClick={() => onChangeQuery('')} type="button">×</button>}
          </label>
        </header>

        <div className="source-creators" aria-label="按信源筛选">
          <button aria-pressed={creatorId === null} onClick={() => onChangeCreator(null)} type="button">全部信源 <small>{contents.length}</small></button>
          {creators.map((creator) => {
            const count = contents.filter((content) => content.creator_id === creator.id).length
            if (!count) return null
            return <button aria-pressed={creatorId === creator.id} key={creator.id} onClick={() => onChangeCreator(creator.id)} type="button">{creator.name} <small>{count}</small></button>
          })}
        </div>

        <div className="source-list" aria-busy={loadMode === 'loading'}>
          {loadMode === 'loading' && [0, 1, 2, 3].map((item) => <div className="source-row source-row-skeleton" key={item}><i /><span /><span /></div>)}
          {loadMode !== 'loading' && visibleContents.map((content, index) => {
            const date = dateParts(content.published_at)
            const scored = content.n_hit + content.n_partial + content.n_miss
            const total = Math.max(content.n_units, 1)
            return (
              <button className="source-row" key={content.id} onClick={() => onOpenContent(content.id)} type="button">
                <span className="source-date"><b>{date.day}</b><em>{date.month} {date.year}</em></span>
                <span className="source-row-main">
                  <span><b>{content.creator}</b><em>{platformLabels[content.platform] ?? content.platform}</em></span>
                  <strong>{content.title}</strong>
                  <span className="source-unit-bar" aria-label={`${content.n_units} 个知识单元`}>
                    <i className="bar-claim" style={{ flex: content.n_claims / total }} />
                    <i className="bar-method" style={{ flex: content.n_methods / total }} />
                    <i className="bar-concept" style={{ flex: content.n_concepts / total }} />
                  </span>
                </span>
                <span className="source-row-facts">
                  <span><b>{content.n_units}</b> 个单元</span>
                  <span>{scored ? `${scored} 个裁决` : '等待裁决'}</span>
                </span>
                <span className="source-row-index">{String(index + 1).padStart(2, '0')} ↗</span>
              </button>
            )
          })}
          {loadMode !== 'loading' && visibleContents.length === 0 && (
            <div className="source-empty"><span>NO MATCHED SOURCE</span><strong>没有匹配的原始内容</strong><button onClick={() => { onChangeQuery(''); onChangeCreator(null) }} type="button">清除条件</button></div>
          )}
        </div>
      </section>

      <section className="source-next">
        <header><span>CONTINUE FROM SOURCE</span><h2>证据之后，才是知识。</h2></header>
        <button onClick={onShowNodes} type="button"><span>长期知识</span><p>查看跨内容归并、修正并保留来源的规范知识。</p><i>02 / 归并层 ↗</i></button>
        <button onClick={onShowEvidence} type="button"><span>逐字证据</span><p>跨全部内容检索原句、标的、判据与评分结果。</p><i>全文检索 · ⌘K</i></button>
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
  onOpenNode,
  onOpenUnit,
  onRetry,
}: {
  bundle: ContentBundle | null
  content: KnowledgeContentSummary
  isPreview: boolean
  mode: ReaderMode
  nodes: KnowledgeNode[]
  onOpenNode: (id: number) => void
  onOpenUnit: (id: number) => void
  onRetry: () => void
}) {
  const [kind, setKind] = useState<KindFilter>('all')
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
  const opening = raw?.transcript.slice(0, 1100) ?? ''

  if (mode === 'loading' || mode === 'idle') return <SourceReaderSkeleton content={content} />
  if (mode === 'error' || !bundle || !raw) {
    return <div className="reader-error"><span>CONTENT UNAVAILABLE</span><strong>这期原始内容暂时没有载入</strong><p>来源索引仍可使用，重试不会改变内容记录。</p><button onClick={onRetry} type="button">重新读取</button></div>
  }

  return (
    <article className="source-document">
      <nav className="document-flow" aria-label="本期内容的知识形成顺序">
        <a className="is-current" href="#source-original"><span>01</span><b>原始内容</b></a>
        <a href="#source-units"><span>02</span><b>提取单元</b></a>
        <a href="#source-nodes"><span>03</span><b>长期知识</b></a>
        <a href="#source-verdicts"><span>04</span><b>市场裁决</b></a>
      </nav>

      <header className="source-document-lead">
        <div><span>CONTENT / {String(content.id).padStart(3, '0')}</span><b>{platformLabels[content.platform] ?? content.platform}</b></div>
        <p>{content.creator} · {formatDate(content.published_at, true)}</p>
        <h1>{content.title}</h1>
        <dl>
          <div><dt>原文字数</dt><dd>{compactNumber(content.raw_len)}</dd></div>
          <div><dt>知识单元</dt><dd>{content.n_units}</dd></div>
          <div><dt>判断 / 方法 / 认知</dt><dd>{content.n_claims} / {content.n_methods} / {content.n_concepts}</dd></div>
          <div><dt>状态</dt><dd>{content.status === 'extracted' ? '已提取' : '待提取'}</dd></div>
        </dl>
      </header>

      {isPreview && <div className="document-preview-note">预览模式仅显示经过核对的原文节选与部分提取单元。</div>}

      <section className="source-document-section original-section" id="source-original">
        <header><span>01 / L0</span><div><h2>原始内容</h2><p>来源、发布时间和逐字表达保持不变，是之后所有提取与裁决的锚点。</p></div></header>
        <div className="original-reading">
          <div className="original-reading-meta"><span>原文起始</span>{content.url && <a href={content.url} rel="noreferrer" target="_blank">访问原始来源 ↗</a>}</div>
          <p>{opening}{raw.transcript.length > opening.length ? '…' : ''}</p>
          <details>
            <summary><span>完整转录</span><b>{compactNumber(raw.transcript.length)} 字 · 展开</b></summary>
            <div>{raw.transcript}</div>
          </details>
          {raw.visualNotes && <details><summary><span>画面信息与图表笔记</span><b>带时间戳 · 展开</b></summary><div>{raw.visualNotes}</div></details>}
        </div>
      </section>

      <section className="source-document-section units-section" id="source-units">
        <header><span>02 / L1</span><div><h2>从原文提取出的知识</h2><p>每个结构化单元都保留完整引文，判断的验证口径在这一刻冻结。</p></div></header>
        <div className="unit-reading">
          <div className="unit-kind-switch">
            {(['all', 'claim', 'method', 'concept'] as const).map((value) => (
              <button aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">
                {value === 'all' ? '全部' : kindLabels[value]}
                <small>{value === 'all' ? units.length : units.filter((unit) => unit.kind === value).length}</small>
              </button>
            ))}
          </div>
          {visibleUnits.map((unit, index) => (
            <article className={`source-unit kind-${unit.kind}`} key={unit.id}>
              <aside><b>{String(index + 1).padStart(2, '0')}</b><span>{kindLabels[unit.kind]}</span><em>{unit.locator ?? `#${unit.id}`}</em></aside>
              <div>
                <h3>{unitStatement(unit)}</h3>
                <blockquote>{unit.quote}</blockquote>
                {unitFacts(unit).map((fact, factIndex) => <p className="unit-fact" key={`${factIndex}-${fact}`}>{fact}</p>)}
                <footer>
                  <span>{unit.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
                  <button disabled={isPreview} onClick={() => onOpenUnit(unit.id)} type="button">{isPreview ? '预览节选' : '核查完整单元 ↗'}</button>
                </footer>
                {unit.kind === 'claim' && <UnitScores scores={unit.scores} />}
              </div>
            </article>
          ))}
          {!visibleUnits.length && <p className="section-empty">本期没有这一类提取单元。</p>}
        </div>
      </section>

      <section className="source-document-section nodes-section" id="source-nodes">
        <header><span>03 / L3</span><div><h2>同主题的长期知识</h2><p>按本期主题寻找已有节点。共同标签只表示继续阅读的方向，具体归并仍以提及关系为准。</p></div></header>
        <div className="source-related-nodes">
          {relatedNodes.map(({ node }) => (
            <button key={node.id} onClick={() => onOpenNode(node.id)} type="button">
              <span><b>{kindLabels[node.kind]}</b><em>{statusLabels[node.status]}</em></span>
              <strong>{node.title}</strong><p>{node.canonical}</p><i>{node.n_attest} 次提及 ↗</i>
            </button>
          ))}
          {!relatedNodes.length && <p className="section-empty">当前还没有与本期主题相接的长期节点。新内容归并后，这里会形成继续阅读的路径。</p>}
        </div>
      </section>

      <section className="source-document-section verdicts-section" id="source-verdicts">
        <header><span>04 / L2</span><div><h2>市场裁决</h2><p>只呈现按照提取时冻结的判据机械执行后得到的结果。</p></div></header>
        <div className="source-verdict-list">
          {scoreEntries.map(({ score, unit }, index) => (
            <div className={`source-verdict outcome-${score.outcome}`} key={`${unit.id}-${score.horizon_label}-${index}`}>
              <span>{outcomeLabels[score.outcome] ?? score.outcome}</span><time>{score.horizon_label}</time><strong>{unitStatement(unit)}</strong><p>{unit.quote}</p>
            </div>
          ))}
          {!scoreEntries.length && <p className="section-empty">本期判断尚未形成到期裁决。没有百分比，只有仍在等待的冻结判据。</p>}
        </div>
      </section>

      <footer className="source-document-foot"><span>原始表达不被覆盖</span><b>SOURCE → UNIT → KNOWLEDGE → VERDICT</b></footer>
    </article>
  )
}

function UnitScores({ scores }: { scores: UnitScore[] }) {
  if (!scores.length) return <div className="unit-scores is-pending">评分待到期</div>
  return <div className="unit-scores">{scores.map((score, index) => <span className={`outcome-${score.outcome}`} key={`${score.horizon_label}-${index}`}><b>{score.horizon_label}</b>{outcomeLabels[score.outcome] ?? score.outcome}</span>)}</div>
}

function SourceReaderSkeleton({ content }: { content: KnowledgeContentSummary }) {
  return <article className="source-document source-reader-skeleton"><span>CONTENT / {String(content.id).padStart(3, '0')}</span><h1>{content.title}</h1><i /><i /><i /><i /></article>
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
  return (
    <main className="node-library-stage">
      <header className="node-library-lead">
        <button onClick={onShowSources} type="button">← 回到原始内容</button>
        <div><span>KNOWLEDGE / SETTLED</span><h1>长期知识</h1></div>
        <p>这里不是第二份内容列表。只有能够跨内容复用、保留演进关系并持续接受证据修正的表述，才成为节点。</p>
      </header>
      {loadMode === 'preview' && <div className="preview-notice"><i /><span>后端未连接，当前显示仓库内的真实归并样本。</span></div>}
      <section className="node-index">
        <header>
          <label><span aria-hidden="true">⌕</span><input aria-label="搜索长期知识" onChange={(event) => onChangeQuery(event.target.value)} placeholder="搜索主题、标的或规范陈述" value={query} />{query && <button onClick={() => onChangeQuery('')} type="button">×</button>}</label>
          <p><b>{visibleNodes.length}</b> / {nodes.length}</p>
        </header>
        <div className="node-kind-switch">
          {(['all', 'concept', 'method', 'claim'] as const).map((value) => <button aria-pressed={kind === value} key={value} onClick={() => onChangeKind(value)} type="button">{value === 'all' ? '全部' : kindLabels[value]} <small>{value === 'all' ? nodes.length : nodes.filter((node) => node.kind === value).length}</small></button>)}
        </div>
        <div className="node-list" aria-busy={loadMode === 'loading'}>
          {loadMode === 'loading' && [0, 1, 2, 3].map((item) => <div className="node-row node-row-skeleton" key={item}><i /><span /><span /></div>)}
          {loadMode !== 'loading' && visibleNodes.map((node, index) => (
            <button className={`node-row kind-${node.kind}`} key={node.id} onClick={() => onOpenNode(node.id)} type="button">
              <span className="node-row-index">{String(index + 1).padStart(3, '0')}</span>
              <span className="node-row-copy"><span><b>{kindLabels[node.kind]}</b><em>{statusLabels[node.status]}</em></span><strong>{node.title}</strong><p>{node.canonical}</p><small>{node.tags.slice(0, 4).join(' · ')}</small></span>
              <KnowledgeTrace node={node} />
              <span className="node-row-open">阅读 ↗</span>
            </button>
          ))}
        </div>
      </section>
      <footer className="knowledge-footer"><span>FANISL / SETTLED KNOWLEDGE</span><p>每条节点仍能回到其原始内容和逐字证据。</p></footer>
    </main>
  )
}

function NodeDocument({
  detail,
  mode,
  node,
  onOpenNode,
  onOpenUnit,
  onRetry,
}: {
  detail: KnowledgeNodeDetail | null
  mode: ReaderMode
  node: KnowledgeNode
  onOpenNode: (id: number) => void
  onOpenUnit: (id: number) => void
  onRetry: () => void
}) {
  const scoreCount = node.hit + node.partial + node.miss
  const hitRate = scoreCount ? Math.round(((node.hit + node.partial * .5) / scoreCount) * 100) : null
  return (
    <article className={`node-document kind-${node.kind}`}>
      <header className="node-document-lead">
        <div><span>KNOWLEDGE NODE / {String(node.id).padStart(3, '0')}</span><b>{kindLabels[node.kind]} · {statusLabels[node.status]}</b></div>
        <h1>{node.title}</h1><p>{node.canonical}</p>
        <span className="node-document-tags">{node.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
        <dl><div><dt>提及</dt><dd>{node.n_attest}</dd></div><div><dt>原始内容</dt><dd>{node.n_contents}</dd></div><div><dt>独立信源</dt><dd>{node.n_creators}</dd></div><div><dt>时间跨度</dt><dd>{formatDate(node.first_seen)} — {formatDate(node.last_seen)}</dd></div></dl>
      </header>
      <section className="node-document-section"><header><span>01</span><h2>归并说明</h2></header><blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote></section>
      <section className="node-document-section node-attestations"><header><span>02</span><h2>从哪些原始内容形成</h2></header><div>
        {mode === 'loading' && <p className="section-empty">正在读取完整提及链…</p>}
        {mode === 'error' && <p className="section-empty">完整提及链暂时没有载入。 <button onClick={onRetry} type="button">重新读取</button></p>}
        {mode === 'preview' && <p className="section-empty">预览样本只包含节点摘要；连接后端后会显示完整原文提及链。</p>}
        {mode === 'loaded' && detail?.attestations.map((item, index) => <article key={`${item.unit_id}-${index}`}><aside><time>{formatDate(item.published_at, true)}</time><b>{attestationLabels[item.relation]}</b></aside><div><span>{item.creator} · {item.content_title}</span><blockquote>{item.quote}</blockquote>{item.note && <p>{item.note}</p>}<button onClick={() => onOpenUnit(item.unit_id)} type="button">核查逐字证据 #{item.unit_id} ↗</button></div></article>)}
        {mode === 'loaded' && detail?.attestations.length === 0 && <p className="section-empty">该节点尚未返回提及记录。</p>}
      </div></section>
      <section className="node-document-section node-verdict"><header><span>03</span><h2>市场裁决</h2></header>{hitRate === null ? <p className="section-empty">尚未形成足够的到期评分，不显示 0%。</p> : <div><strong>{hitRate}%</strong><span>加权命中率 · n={scoreCount}</span><p>命中 {node.hit} · 部分 {node.partial} · 未中 {node.miss}</p></div>}</section>
      <section className="node-document-section node-relations"><header><span>04</span><h2>继续阅读</h2></header><div>{mode === 'loaded' && detail?.relations.map((relation) => <button key={`${relation.relation}-${relation.other_id}`} onClick={() => onOpenNode(relation.other_id)} type="button"><span>{relationLabels[relation.relation]}</span><strong>{relation.other_title}</strong><p>{relation.note}</p><i>打开节点 ↗</i></button>)}{mode === 'loaded' && detail?.relations.length === 0 && <p className="section-empty">当前没有经过人工确认的对立或互补关系。</p>}</div></section>
      <footer className="node-document-foot"><span>节点随新证据继续演进</span><b>PROVENANCE INTACT</b></footer>
    </article>
  )
}

export default KnowledgePage
