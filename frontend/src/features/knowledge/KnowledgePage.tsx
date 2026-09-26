import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiJson } from '../../shared/api/client'
import { isKnowledgeNodePage, isKnowledgeUnitPage } from '../../shared/api/contracts'
import { fetchAllPages } from '../../shared/api/pages'
import {
  attestationLabels, categoryLabels, contentStatusLabels, directionLabels, kindLabels,
  nodeStatusLabels as statusLabels, outcomeLabels, relationLabels,
} from '../../shared/domain/labels'
import { nextTabIndex } from '../../shared/interaction/tabs'
import { useModalFocus } from '../../shared/interaction/useModalFocus'
import AppHeader from '../../shared/navigation/AppHeader'
import EvidenceDossier from './EvidenceDossier'
import { EVIDENCE_VIEWS, type EvidenceView } from './evidence-views'
import UnitBrowser from './UnitBrowser'
import { previewNodes } from './preview'
import { previewSourceBundles, previewSourceContents } from './source-preview'
import { displayTitle, youtubeThumbnail } from './video'
import type {
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentUnit,
  KnowledgeCreator,
  KnowledgeKind,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeUnitPage,
  UnitScore,
} from './types'
import './knowledge.css'
import './source-workspace.css'

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
type NodePeekView = 'overview' | 'evidence' | 'verdicts' | 'relations'
type ContentBundle = {
  detail: KnowledgeContentDetail
  units: KnowledgeContentUnit[]
}

type HashState = {
  contentId: number | null
  nodeId: number | null
  peekNodeId: number | null
  query: string
  reviewId: number | null
  tab: EvidenceView | null
  unitId: number | null
  view: KnowledgeView
}

// 内容列表一次取的上限。接近它之前要请接口加分页（offset 与 total），否则最老的内容又会被截掉
const CONTENTS_LIMIT = 2000

function positiveId(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function readHashState(): HashState {
  const query = window.location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const contentId = positiveId(params.get('content'))
  const nodeId = positiveId(params.get('node'))
  const peekNodeId = contentId ? positiveId(params.get('peekNode')) : null
  const unitId = positiveId(params.get('unit'))
  const requestedView = params.get('view')
  const requestedTab = params.get('tab')
  return {
    contentId,
    nodeId,
    peekNodeId,
    query: params.get('q')?.trim() ?? '',
    reviewId: positiveId(params.get('review')),
    tab: EVIDENCE_VIEWS.includes(requestedTab as EvidenceView) ? requestedTab as EvidenceView : null,
    unitId,
    view: contentId ? 'sources' : nodeId ? 'nodes' : requestedView === 'nodes'
      ? 'nodes'
      : requestedView === 'evidence' || params.get('search') === '1'
        ? 'evidence'
        : 'sources',
  }
}

// 深链到一条单元时，窄屏要直接打开阅读抽屉——否则落地看到的是列表，那条单元藏在关着的抽屉里
function narrowScreen() {
  return window.matchMedia('(max-width: 900px)').matches
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
  // 只认规范符号：v2 的 asset_text 装的是定级理由，做标题读不成标的
  const asset = asText(unit.payload.asset_symbol) ?? '市场判断'
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
    categoryLabels[asText(unit.payload.category) ?? ''] ?? asText(unit.payload.category),
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

const NODE_PAGE_SIZE = 200

function loadAllNodes(signal: AbortSignal) {
  return fetchAllPages<KnowledgeNode>(
    (offset) => `/knowledge/nodes-page?limit=${NODE_PAGE_SIZE}&offset=${offset}`,
    NODE_PAGE_SIZE,
    { signal },
    isKnowledgeNodePage,
  )
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
  const [initial] = useState(readHashState)
  const contentCacheRef = useRef(new Map<number, ContentBundle>())
  const nodeCacheRef = useRef(new Map<number, KnowledgeNodeDetail>())
  const contextTriggerRef = useRef<HTMLElement | null>(null)
  const evidenceTriggerRef = useRef<HTMLElement | null>(null)
  const [view, setView] = useState<KnowledgeView>(initial.view)
  const [contents, setContents] = useState<KnowledgeContentSummary[]>([])
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [creators, setCreators] = useState<KnowledgeCreator[]>([])
  const [loadMode, setLoadMode] = useState<LoadMode>('loading')
  // 节点单独一条加载线：原始内容首屏只要内容与信源，不该等 500 多个节点（三页、四百多 KB）
  const [nodesMode, setNodesMode] = useState<LoadMode>('loading')
  const [contentId, setContentId] = useState<number | null>(initial.contentId)
  const [contentPayload, setContentPayload] = useState<ContentBundle | null>(null)
  const [contentMode, setContentMode] = useState<ReaderMode>('idle')
  const [contentRequestKey, setContentRequestKey] = useState(0)
  const [nodeId, setNodeId] = useState<number | null>(initial.nodeId)
  const [peekNodeId, setPeekNodeId] = useState<number | null>(initial.peekNodeId)
  const [nodeDetail, setNodeDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [nodeMode, setNodeMode] = useState<ReaderMode>('idle')
  const [nodeRequestKey, setNodeRequestKey] = useState(0)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)
  const [evidenceParentTitle, setEvidenceParentTitle] = useState<string | null>(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [creatorId, setCreatorId] = useState<number | null>(null)
  const [nodeQuery, setNodeQuery] = useState('')
  const [nodeKind, setNodeKind] = useState<KindFilter>('all')
  const [units, setUnits] = useState<KnowledgeUnitPage | null>(null)
  const [unitsLoaded, setUnitsLoaded] = useState(false)
  const [unitMode, setUnitMode] = useState<LoadMode>('loading')
  const [unitFiltersOpen, setUnitFiltersOpen] = useState(false)
  const [unitReaderOpen, setUnitReaderOpen] = useState(() => initial.view === 'evidence' && initial.unitId !== null && narrowScreen())
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(initial.unitId)
  const [routeQuery, setRouteQuery] = useState(initial.query)
  // 地址栏点名的单元与 tab（「待确认」与标的页从这里进来）。与 selectedUnitId 分开：用户在列表里点了
  // 别的单元，选中项会变，但"链接要打开哪个 tab、滚到哪条核查"只对点名的那一条生效
  const [linked, setLinked] = useState({ unitId: initial.unitId, tab: initial.tab, reviewId: initial.reviewId })
  const [unitFocusKey, setUnitFocusKey] = useState(view === 'evidence' ? 1 : 0)

  useEffect(() => {
    const controller = new AbortController()
    const loadNodes = () => loadAllNodes(controller.signal).then((nodeRows) => {
      setNodes(nodeRows)
      setNodesMode('live')
    }).catch(() => {
      if (controller.signal.aborted) return
      setNodes(previewNodes)
      setNodesMode('preview')
    })
    // 直接打开长期知识（或某个节点）时节点就是首屏，与内容一起取；其余情况等内容到了再取，
    // 免得四百多 KB 的节点和内容列表抢带宽（线上条件回放：原始内容首屏 4.0s → 2.4s）
    const nodesFirst = initial.view === 'nodes' || initial.nodeId !== null || initial.peekNodeId !== null
    if (nodesFirst) void loadNodes()
    Promise.all([
      // 接口没有分页与总数，一次取全。原先 limit=200，09-25 内容到了 207 条，最老的 7 条被静默截掉
      apiJson<KnowledgeContentSummary[]>(`/knowledge/contents?limit=${CONTENTS_LIMIT}`, { signal: controller.signal }),
      apiJson<KnowledgeCreator[]>('/knowledge/creators', { signal: controller.signal }),
    ]).then(([contentRows, creatorRows]) => {
      setContents(contentRows)
      setCreators(creatorRows)
      setLoadMode('live')
    }).catch(() => {
      if (controller.signal.aborted) return
      setContents(previewSourceContents)
      setCreators([
        { id: 1, name: 'Andy Lee 财经', lang: 'zh', focus: null, notes: null, active: true, created_at: '' },
        { id: 2, name: '美投君', lang: 'zh', focus: null, notes: null, active: true, created_at: '' },
      ])
      setLoadMode('preview')
    }).finally(() => {
      if (!nodesFirst && !controller.signal.aborted) void loadNodes()
    })
    return () => controller.abort()
  }, [initial])

  const selectedContent = contents.find((content) => content.id === contentId) ?? null
  const requestedNodeId = nodeId ?? peekNodeId
  const selectedNode = nodes.find((node) => node.id === requestedNodeId) ?? null
  const selectedStandaloneNode = nodeId === null ? null : selectedNode
  const selectedPeekNode = peekNodeId === null ? null : selectedNode

  useEffect(() => {
    if (contentId === null || loadMode === 'loading') {
      setContentPayload(null)
      setContentMode('idle')
      return
    }
    if (!selectedContent) {
      setContentId(null)
      window.history.replaceState(null, '', '#/knowledge')
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
    if (requestedNodeId === null || nodesMode === 'loading') {
      setNodeDetail(null)
      setNodeMode('idle')
      return
    }
    if (!selectedNode) {
      if (nodeId !== null) setNodeId(null)
      if (peekNodeId !== null) setPeekNodeId(null)
      window.history.replaceState(null, '', contentId !== null ? `#/knowledge?content=${contentId}` : '#/knowledge?view=nodes')
      return
    }
    if (nodesMode === 'preview') {
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
  }, [contentId, nodeId, nodeRequestKey, nodesMode, peekNodeId, requestedNodeId, selectedNode])

  useEffect(() => {
    if (view !== 'evidence' || unitsLoaded || loadMode === 'loading') return
    if (loadMode === 'preview') {
      setUnitMode('preview')
      setUnitsLoaded(true)
      return
    }
    const controller = new AbortController()
    apiJson<KnowledgeUnitPage>('/knowledge/units-page?limit=100', { signal: controller.signal }, isKnowledgeUnitPage)
      .then((page) => {
        setUnits(page)
        setSelectedUnitId((current) => current ?? page.items[0]?.id ?? null)
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
      setPeekNodeId(next.peekNodeId)
      setRouteQuery(next.query)
      setSelectedUnitId(next.unitId)
      setLinked({ unitId: next.unitId, tab: next.tab, reviewId: next.reviewId })
      setUnitReaderOpen(next.view === 'evidence' && next.unitId !== null && narrowScreen())
      setEvidenceUnitId(null)
      setEvidenceParentTitle(null)
    }
    window.addEventListener('popstate', syncHistory)
    return () => window.removeEventListener('popstate', syncHistory)
  }, [])

  function switchView(next: KnowledgeView) {
    setView(next)
    setContentId(null)
    setNodeId(null)
    setPeekNodeId(null)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    setUnitReaderOpen(false)
    setUnitFiltersOpen(false)
    setRouteQuery('')
    setSelectedUnitId(null)
    setLinked({ unitId: null, tab: null, reviewId: null })
    window.history.pushState(null, '', next === 'sources' ? '#/knowledge' : `#/knowledge?view=${next}`)
    window.scrollTo({ top: 0, left: 0 })
    if (next === 'evidence') setUnitFocusKey((value) => value + 1)
  }

  function openContent(id: number) {
    setView('sources')
    setNodeId(null)
    setPeekNodeId(null)
    setContentId(id)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    window.history.pushState({ fanislContent: id, fanislReturn: window.location.hash }, '', `#/knowledge?content=${id}`)
    window.scrollTo({ top: 0, left: 0 })
  }

  function openNode(id: number) {
    setView('nodes')
    setContentId(null)
    setPeekNodeId(null)
    setNodeId(id)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    window.history.pushState({ fanislNode: id, fanislReturn: window.location.hash }, '', `#/knowledge?node=${id}`)
    window.scrollTo({ top: 0, left: 0 })
  }

  function replaceStandaloneNode(id: number) {
    setNodeId(id)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    window.history.replaceState({ fanislNode: id }, '', `#/knowledge?node=${id}`)
  }

  function openContextNode(id: number) {
    if (contentId === null) {
      openNode(id)
      return
    }
    const isFirstPeek = peekNodeId === null
    if (isFirstPeek && document.activeElement instanceof HTMLElement) contextTriggerRef.current = document.activeElement
    setPeekNodeId(id)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    const nextUrl = `#/knowledge?content=${contentId}&peekNode=${id}`
    if (isFirstPeek) window.history.pushState({ fanislContent: contentId, fanislPeekNode: id }, '', nextUrl)
    else window.history.replaceState({ fanislContent: contentId, fanislPeekNode: id }, '', nextUrl)
  }

  function closeContextNode() {
    const trigger = contextTriggerRef.current
    setPeekNodeId(null)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    const state = window.history.state as { fanislPeekNode?: number } | null
    if (state?.fanislPeekNode) window.history.back()
    else if (contentId !== null) window.history.replaceState({ fanislContent: contentId }, '', `#/knowledge?content=${contentId}`)
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus()
      contextTriggerRef.current = null
    })
  }

  function openEvidence(id: number, parentTitle: string) {
    if (document.activeElement instanceof HTMLElement) evidenceTriggerRef.current = document.activeElement
    setEvidenceParentTitle(parentTitle)
    setEvidenceUnitId(id)
  }

  function closeEvidence() {
    const trigger = evidenceTriggerRef.current
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus()
      evidenceTriggerRef.current = null
    })
  }

  function closeReader() {
    const next = view === 'nodes' ? 'nodes' : 'sources'
    setContentId(null)
    setNodeId(null)
    setPeekNodeId(null)
    setEvidenceUnitId(null)
    setEvidenceParentTitle(null)
    const state = window.history.state as { fanislContent?: number; fanislNode?: number } | null
    if (state?.fanislContent || state?.fanislNode) window.history.back()
    else window.history.replaceState(null, '', next === 'sources' ? '#/knowledge' : '#/knowledge?view=nodes')
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
      if (evidenceUnitId !== null) closeEvidence()
      else if (peekNodeId !== null) closeContextNode()
      else if (unitFiltersOpen) setUnitFiltersOpen(false)
      else if (unitReaderOpen) setUnitReaderOpen(false)
      else if (contentId !== null || nodeId !== null) closeReader()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  useEffect(() => {
    if (evidenceUnitId === null && peekNodeId === null && !unitFiltersOpen && !unitReaderOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [evidenceUnitId, peekNodeId, unitFiltersOpen, unitReaderOpen])

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
      <div className="knowledge-page source-document-page app-page">
        {evidenceUnitId === null && <AppHeader current="knowledge" onSearch={headerSearch} />}
        <main className="source-document-stage">
          <button className="reader-back" onClick={closeReader} type="button">← 返回原始内容</button>
          <SourceDocument
            // 换一期内容就换一份组件状态（tab 回到原文、筛选回到全部），不在 effect 里逐个重置
            key={selectedContent.id}
            bundle={contentPayload}
            content={selectedContent}
            isPreview={contentMode === 'preview'}
            mode={contentMode}
            nodes={nodes}
            onOpenNode={openContextNode}
            onOpenUnit={(id) => openEvidence(id, selectedContent.title)}
            onRetry={() => setContentRequestKey((value) => value + 1)}
          />
          {peekNodeId !== null && selectedPeekNode && (
            <NodeContextPreview
              contentTitle={selectedContent.title}
              detail={nodeDetail}
              mode={nodeMode}
              node={selectedPeekNode}
              obscured={evidenceUnitId !== null}
              onClose={closeContextNode}
              onOpenNode={openContextNode}
              onOpenUnit={(id) => openEvidence(id, selectedPeekNode.title)}
              onRetry={() => setNodeRequestKey((value) => value + 1)}
            />
          )}
          {evidenceUnitId !== null && contentMode !== 'preview' && (
            <div className="knowledge-evidence-layer">
              <EvidenceDossier
                backLabel={peekNodeId !== null ? '返回关联知识' : '返回本期内容'}
                onClose={closeEvidence}
                parentLabel={peekNodeId !== null ? '长期知识' : '内容'}
                parentTitle={evidenceParentTitle ?? selectedContent.title}
                unitId={evidenceUnitId}
              />
            </div>
          )}
        </main>
      </div>
    )
  }

  if (nodeId !== null && selectedStandaloneNode) {
    return (
      <div className="knowledge-page node-document-page app-page">
        {evidenceUnitId === null && <AppHeader current="knowledge" onSearch={headerSearch} />}
        <main className="node-document-stage">
          <NodeContextPreview
            contentTitle="从长期知识总库打开"
            detail={nodeDetail}
            mode={nodeMode}
            node={selectedStandaloneNode}
            obscured={evidenceUnitId !== null}
            onClose={closeReader}
            onOpenNode={replaceStandaloneNode}
            onOpenUnit={(id) => openEvidence(id, selectedStandaloneNode.title)}
            onRetry={() => setNodeRequestKey((value) => value + 1)}
            standalone
          />
          {evidenceUnitId !== null && nodeMode !== 'preview' && (
            <div className="knowledge-evidence-layer">
              <EvidenceDossier
                onClose={closeEvidence}
                parentTitle={evidenceParentTitle ?? selectedStandaloneNode.title}
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
      <div className="knowledge-page knowledge-evidence-page app-page">
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <main className="evidence-search-stage">
          <KnowledgeHead onSwitch={switchView} view="evidence" />
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
              initialQuery={routeQuery}
              initialPage={units}
              isPreview={unitMode === 'preview'}
              linkedReviewId={linked.reviewId}
              linkedTab={linked.tab}
              linkedUnitId={linked.unitId}
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
      <div className="knowledge-page node-library-page app-page">
        <AppHeader current="knowledge" onSearch={headerSearch} />
        <NodeLibrary
          kind={nodeKind}
          loadMode={nodesMode}
          nodes={nodes}
          onChangeKind={setNodeKind}
          onChangeQuery={setNodeQuery}
          onOpenNode={openNode}
          onSwitch={switchView}
          query={nodeQuery}
          visibleNodes={visibleNodes}
        />
      </div>
    )
  }

  return (
    <div className="knowledge-page source-library-page app-page">
      <AppHeader current="knowledge" onSearch={headerSearch} />
      <SourceLibrary
        contents={contents}
        creatorId={creatorId}
        creators={creators}
        loadMode={loadMode}
        onChangeCreator={setCreatorId}
        onChangeQuery={setSourceQuery}
        onOpenContent={openContent}
        onSwitch={switchView}
        query={sourceQuery}
        visibleContents={visibleContents}
      />
    </div>
  )
}

const knowledgeViews: Array<[KnowledgeView, string]> = [['sources', '原始内容'], ['nodes', '长期知识'], ['evidence', '逐字证据']]

/** 知识库三个视图共用的页头：标题 + 视图切换，右侧放各视图自己的搜索 */
function KnowledgeHead({ children, onSwitch, view }: {
  children?: ReactNode
  onSwitch: (view: KnowledgeView) => void
  view: KnowledgeView
}) {
  return (
    <header className="page-head">
      <h1>知识库</h1>
      <nav aria-label="知识库视图" className="page-tabs">
        {knowledgeViews.map(([key, label]) => (
          <button aria-pressed={view === key} key={key} onClick={() => onSwitch(key)} type="button">{label}</button>
        ))}
      </nav>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  )
}

function SourceLibrary({
  contents,
  creatorId,
  creators,
  loadMode,
  onChangeCreator,
  onChangeQuery,
  onOpenContent,
  onSwitch,
  query,
  visibleContents,
}: {
  contents: KnowledgeContentSummary[]
  creatorId: number | null
  creators: KnowledgeCreator[]
  loadMode: LoadMode
  onChangeCreator: (id: number | null) => void
  onChangeQuery: (value: string) => void
  onOpenContent: (id: number) => void
  onSwitch: (view: KnowledgeView) => void
  query: string
  visibleContents: KnowledgeContentSummary[]
}) {
  return (
    <main className="source-library-stage">
      <KnowledgeHead onSwitch={onSwitch} view="sources">
        <span className="page-count"><b>{visibleContents.length}</b> / {contents.length}</span>
        <label className="field-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="搜索内容"
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="标题或信源"
            value={query}
          />
          {query && <button aria-label="清空搜索" onClick={() => onChangeQuery('')} type="button">×</button>}
        </label>
      </KnowledgeHead>

      {loadMode === 'preview' && (
        <div className="preview-notice"><i /><span>后端未连接，当前显示仓库内的真实内容样本。</span></div>
      )}

      <section className="video-library">
        <div aria-label="按信源筛选" className="chips video-library-tabs" role="group">
          <button aria-pressed={creatorId === null} onClick={() => onChangeCreator(null)} type="button">全部 <small>{contents.length}</small></button>
          {creators.map((creator) => {
            const count = contents.filter((content) => content.creator_id === creator.id).length
            if (!count) return null
            return <button aria-pressed={creatorId === creator.id} key={creator.id} onClick={() => onChangeCreator(creator.id)} type="button">{creator.name} <small>{count}</small></button>
          })}
        </div>

        <div className="video-grid" aria-busy={loadMode === 'loading'}>
          {loadMode === 'loading' && Array.from({ length: 8 }, (_, item) => <div className="video-card video-card-skeleton" key={item}><i /><span /><span /></div>)}
          {loadMode !== 'loading' && visibleContents.map((content) => {
            const thumbnail = youtubeThumbnail(content.url, loadMode === 'preview' ? 'local' : 'remote')
            const scored = content.n_hit + content.n_partial + content.n_miss
            // 没提取过的（待提取、仅供阅读）写状态，不写一串 0
            const units = content.n_units > 0
              ? [
                content.n_claims && `${content.n_claims} 判断`,
                content.n_methods && `${content.n_methods} 方法`,
                content.n_concepts && `${content.n_concepts} 认知`,
                scored && `${scored} 个裁决`,
              ].filter(Boolean).join(' · ')
              : contentStatusLabels[content.status] ?? content.status
            return (
              // 整张卡片一个按钮：点缩略图和点标题去的是同一处，不必让键盘停两次
              <button aria-label={`打开内容：${displayTitle(content.title)}`} className="video-card" key={content.id} onClick={() => onOpenContent(content.id)} type="button">
                <span className="video-thumbnail">
                  {thumbnail && <img alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} src={thumbnail} />}
                </span>
                <strong>{displayTitle(content.title)}</strong>
                <span className="video-card-meta">{content.creator} · {formatDate(content.published_at, true)}</span>
                <span className="video-card-units">{units}</span>
              </button>
            )
          })}
          {loadMode !== 'loading' && visibleContents.length === 0 && (
            <div className="source-empty"><strong>没有匹配的内容</strong><button onClick={() => { onChangeQuery(''); onChangeCreator(null) }} type="button">清除条件</button></div>
          )}
        </div>
      </section>


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
  const thumbnail = youtubeThumbnail(content.url, isPreview ? 'local' : 'remote')

  useEffect(() => {
    viewScrollRef.current?.scrollTo({ top: 0 })
  }, [activeView, kind])

  if (mode === 'loading' || mode === 'idle') return <SourceReaderSkeleton content={content} />
  if (mode === 'error' || !bundle || !raw) {
    return <div className="reader-error"><strong>这期原始内容暂时没有载入</strong><button onClick={onRetry} type="button">重新读取</button></div>
  }

  return (
    <article className="source-workspace">
      <header className="source-workspace-head">
        <div className="source-workspace-title">
          <h1>{displayTitle(content.title)}</h1>
          <p>{content.creator} · {formatDate(content.published_at, true)} · {platformLabels[content.platform] ?? content.platform} · {contentStatusLabels[content.status] ?? content.status}</p>
        </div>
        {content.url && <a className="source-external-link" href={content.url} rel="noreferrer" target="_blank">打开原始视频 ↗</a>}
      </header>

      <div className="source-workspace-body">
        <aside className="source-context-pane">
          {/* 这里的缩略图链到 YouTube 原视频，▶ 是真的能播 */}
          {thumbnail && (
            <a className="source-context-media" href={content.url ?? undefined} rel="noreferrer" target="_blank">
              <img alt={`${displayTitle(content.title)} 视频缩略图`} onError={(event) => { event.currentTarget.hidden = true }} src={thumbnail} />
              <span aria-hidden="true">▶</span>
            </a>
          )}
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
          <nav
            aria-label="内容研究视图"
            className="source-view-tabs"
            onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
              const index = tabs.indexOf(event.target as HTMLButtonElement)
              const next = nextTabIndex(event.key, index, tabs.length)
              if (next === null) return
              event.preventDefault()
              tabs[next].click()
              tabs[next].focus()
            }}
            role="tablist"
          >
            {([
              ['original', '原始内容', compactNumber(raw.transcript.length)],
              ['units', '提取单元', String(units.length)],
              ['nodes', '长期知识', String(relatedNodes.length)],
              ['verdicts', '市场裁决', String(scoreEntries.length)],
            ] as const).map(([value, label, count]) => (
              <button
                aria-selected={activeView === value}
                aria-controls={`content-${content.id}-panel-${value}`}
                id={`content-${content.id}-tab-${value}`}
                key={value}
                onClick={() => setActiveView(value)}
                role="tab"
                tabIndex={activeView === value ? 0 : -1}
                type="button"
              >
                <span>{label}</span><b>{count}</b>
              </button>
            ))}
          </nav>

          <div aria-labelledby={`content-${content.id}-tab-${activeView}`} aria-live="polite" className="source-view-scroll" id={`content-${content.id}-panel-${activeView}`} ref={viewScrollRef} role="tabpanel" tabIndex={0}>
            {activeView === 'original' && (
              <section className="source-original-view">
                <header><div><h2>逐字原文</h2></div></header>
                <article>{raw.transcript}</article>
                {raw.visualNotes && <section className="source-visual-notes"><span>画面信息与图表笔记</span><p>{raw.visualNotes}</p></section>}
              </section>
            )}

            {activeView === 'units' && (
              <section className="source-units-view">
                <header className="source-view-heading"><div><h2>提取单元</h2></div></header>
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
                <header className="source-view-heading"><div><h2>同主题的长期知识</h2></div></header>
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
                <header className="source-view-heading"><div><h2>市场裁决</h2></div></header>
                <div className="source-workspace-verdicts">
                  {scoreEntries.map(({ score, unit }, index) => (
                    <button className={`outcome-${score.outcome}`} disabled={isPreview} key={`${unit.id}-${score.horizon_label}-${index}`} onClick={() => onOpenUnit(unit.id)} type="button">
                      <span>{outcomeLabels[score.outcome] ?? score.outcome}</span><time>{score.horizon_label}</time><strong>{unitStatement(unit)}</strong><p>{unit.quote}</p><i>{isPreview ? '预览结果' : '核查 ↗'}</i>
                    </button>
                  ))}
                  {!scoreEntries.length && <div className="source-pending-state"><strong>判断尚未到达裁决时点</strong></div>}
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
  return <article className="source-workspace source-reader-skeleton"><h1>{displayTitle(content.title)}</h1><i /><i /><i /><i /></article>
}

function NodeLibrary({
  kind,
  loadMode,
  nodes,
  onChangeKind,
  onChangeQuery,
  onOpenNode,
  onSwitch,
  query,
  visibleNodes,
}: {
  kind: KindFilter
  loadMode: LoadMode
  nodes: KnowledgeNode[]
  onChangeKind: (kind: KindFilter) => void
  onChangeQuery: (value: string) => void
  onOpenNode: (id: number) => void
  onSwitch: (view: KnowledgeView) => void
  query: string
  visibleNodes: KnowledgeNode[]
}) {
  const pageSize = 6
  // 页码跟着筛选条件走，条件一变就回第一页。条件与页码存在一起比，不在 effect 里再 setState 一次
  const filterKey = `${kind}:${query}`
  const [pageState, setPageState] = useState({ filterKey, page: 0 })
  const page = pageState.filterKey === filterKey ? pageState.page : 0
  const setPage = (update: (current: number) => number) => setPageState({ filterKey, page: update(page) })
  const pageCount = Math.max(1, Math.ceil(visibleNodes.length / pageSize))
  const pageNodes = visibleNodes.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <main className="node-library-stage">
      <KnowledgeHead onSwitch={onSwitch} view="nodes">
        <span className="page-count"><b>{visibleNodes.length}</b> / {nodes.length}</span>
        <label className="field-search">
          <span aria-hidden="true">⌕</span>
          <input aria-label="搜索长期知识" onChange={(event) => onChangeQuery(event.target.value)} placeholder="主题、标的或规范陈述" value={query} />
          {query && <button aria-label="清空搜索" onClick={() => onChangeQuery('')} type="button">×</button>}
        </label>
      </KnowledgeHead>
      {loadMode === 'preview' && <div className="preview-notice"><i /><span>后端未连接，当前显示仓库内的真实归并样本。</span></div>}
      <section className="node-index">
        <div aria-label="按类型筛选" className="chips node-kind-switch" role="group">
          {(['all', 'concept', 'method', 'claim'] as const).map((value) => <button aria-pressed={kind === value} key={value} onClick={() => onChangeKind(value)} type="button">{value === 'all' ? '全部' : kindLabels[value]} <small>{value === 'all' ? nodes.length : nodes.filter((node) => node.kind === value).length}</small></button>)}
        </div>
        <div className="node-list" aria-busy={loadMode === 'loading'}>
          {loadMode === 'loading' && [0, 1, 2, 3].map((item) => <div className="node-row node-row-skeleton" key={item}><i /><span /><span /></div>)}
          {loadMode !== 'loading' && pageNodes.map((node, index) => (
            <button className={`node-row kind-${node.kind}`} key={node.id} onClick={() => onOpenNode(node.id)} type="button">
              <span className="node-row-index">{String(page * pageSize + index + 1).padStart(3, '0')}</span>
              <span className="node-row-copy"><span><b>{kindLabels[node.kind]}</b><em>{statusLabels[node.status]}</em></span><strong>{node.title}</strong><p>{node.canonical}</p><small>{node.tags.slice(0, 4).join(' · ')}</small></span>
              <KnowledgeTrace node={node} />
              <span className="node-row-open">阅读 ↗</span>
            </button>
          ))}
          {loadMode !== 'loading' && !pageNodes.length && <div className="node-browser-empty"><strong>没有匹配的长期知识</strong><p>清除搜索条件后重新浏览。</p></div>}
        </div>
        {loadMode !== 'loading' && visibleNodes.length > 0 && (
          <footer className="node-index-pagination">
            <p>第 <b>{page + 1}</b> / {pageCount} 页 · 每页 {pageSize} 条</p>
            <div><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} type="button">← 上一页</button><button disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} type="button">下一页 →</button></div>
          </footer>
        )}
      </section>
    </main>
  )
}

function NodeContextPreview({
  contentTitle,
  detail,
  mode,
  node,
  obscured = false,
  onClose,
  onOpenNode,
  onOpenUnit,
  onRetry,
  standalone = false,
}: {
  contentTitle: string
  detail: KnowledgeNodeDetail | null
  mode: ReaderMode
  node: KnowledgeNode
  obscured?: boolean
  onClose: () => void
  onOpenNode: (id: number) => void
  onOpenUnit: (id: number) => void
  onRetry: () => void
  standalone?: boolean
}) {
  // 换节点回到「归并说明」。视图与节点 id 存在一起，换了节点自然失效；不能用 key 重挂，那会打断焦点管理
  const [viewState, setViewState] = useState<{ nodeId: number; view: NodePeekView }>({ nodeId: node.id, view: 'overview' })
  const activeView = viewState.nodeId === node.id ? viewState.view : 'overview'
  const setActiveView = (next: NodePeekView) => setViewState({ nodeId: node.id, view: next })
  const dialogRef = useRef<HTMLElement>(null)
  const resolvedDetail = detail?.id === node.id ? detail : null
  const scoreCount = node.hit + node.partial + node.miss
  const hitRate = scoreCount ? Math.round(((node.hit + node.partial * .5) / scoreCount) * 100) : null

  useModalFocus(dialogRef, !standalone && !obscured, onClose)

  return (
    <div className={`node-context-layer${standalone ? ' is-standalone' : ''}`}>
      {!standalone && <button aria-label="关闭关联知识" className="node-context-backdrop" onClick={onClose} type="button" />}
      <section aria-hidden={obscured || undefined} aria-labelledby="node-context-title" aria-modal={standalone || obscured ? undefined : true} className={`node-context-dialog kind-${node.kind}`} ref={dialogRef} role={standalone ? 'region' : 'dialog'}>
        <header className="node-context-head">
          <button autoFocus onClick={onClose} type="button">← {standalone ? '返回长期知识' : '返回本期内容'}</button>
          <div><span>{standalone ? '独立知识节点' : '来自内容'}</span><p>{contentTitle}</p></div>
          {!standalone && <button aria-label="关闭关联知识" onClick={onClose} type="button">×</button>}
        </header>
        <div className="node-context-body">
          <aside className="node-context-summary">
            <div><b>{kindLabels[node.kind]} · {statusLabels[node.status]}</b></div>
            <h2 id="node-context-title">{node.title}</h2>
            <blockquote>{node.canonical}</blockquote>
            <span className="node-document-tags">{node.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
            <dl><div><dt>提及</dt><dd>{node.n_attest}</dd></div><div><dt>内容</dt><dd>{node.n_contents}</dd></div><div><dt>信源</dt><dd>{node.n_creators}</dd></div><div><dt>跨度</dt><dd>{formatDate(node.first_seen)} — {formatDate(node.last_seen)}</dd></div></dl>
          </aside>
          <section className="node-context-research">
            <nav
              aria-label="关联知识视图"
              onKeyDown={(event) => {
                const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                const index = tabs.indexOf(event.target as HTMLButtonElement)
                const next = nextTabIndex(event.key, index, tabs.length)
                if (next === null) return
                event.preventDefault()
                tabs[next].click()
                tabs[next].focus()
              }}
              role="tablist"
            >
              {([
                ['overview', '归并说明', '01'],
                ['evidence', '原始证据', String(resolvedDetail?.attestations.length ?? node.n_attest)],
                ['verdicts', '市场裁决', String(scoreCount)],
                ['relations', '关联知识', String(resolvedDetail?.relations.length ?? 0)],
              ] as const).map(([value, label, count]) => <button aria-controls={`node-${node.id}-panel-${value}`} aria-selected={activeView === value} id={`node-${node.id}-tab-${value}`} key={value} onClick={() => setActiveView(value)} role="tab" tabIndex={activeView === value ? 0 : -1} type="button"><span>{label}</span><b>{count}</b></button>)}
            </nav>
            <div aria-labelledby={`node-${node.id}-tab-${activeView}`} className="node-context-scroll" id={`node-${node.id}-panel-${activeView}`} role="tabpanel" tabIndex={0}>
              {activeView === 'overview' && <section className="node-context-overview"><h3>这条知识如何形成</h3><blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote><KnowledgeTrace node={node} /></section>}
              {activeView === 'evidence' && <section className="node-context-evidence"><h3>从哪些原始内容形成</h3>
                {mode === 'loading' && <p className="section-empty">正在读取完整提及链…</p>}
                {mode === 'error' && <p className="section-empty">完整提及链暂时没有载入。 <button onClick={onRetry} type="button">重新读取</button></p>}
                {mode === 'preview' && <p className="section-empty">预览样本只包含节点摘要。</p>}
                {mode === 'loaded' && resolvedDetail?.attestations.map((item, index) => <article key={`${item.unit_id}-${index}`}><div><time>{formatDate(item.published_at, true)}</time><b>{attestationLabels[item.relation]}</b></div><span>{item.creator} · {item.content_title}</span><blockquote>{item.quote}</blockquote>{item.note && <p>{item.note}</p>}<button onClick={() => onOpenUnit(item.unit_id)} type="button">核查逐字证据 #{item.unit_id} ↗</button></article>)}
                {mode === 'loaded' && resolvedDetail?.attestations.length === 0 && <p className="section-empty">该节点尚未返回提及记录。</p>}
              </section>}
              {activeView === 'verdicts' && <section className="node-context-verdict"><h3>市场裁决</h3>{hitRate === null ? <p className="section-empty">尚未形成足够的到期评分，不显示 0%。</p> : <div><strong>{hitRate}%</strong><span>加权命中率 · n={scoreCount}</span><p>命中 {node.hit} · 部分 {node.partial} · 未中 {node.miss}</p></div>}</section>}
              {activeView === 'relations' && <section className="node-context-relations"><h3>继续阅读</h3><div>{mode === 'loaded' && resolvedDetail?.relations.map((relation) => <button key={`${relation.relation}-${relation.other_id}`} onClick={() => onOpenNode(relation.other_id)} type="button"><span>{relationLabels[relation.relation]}</span><strong>{relation.other_title}</strong><p>{relation.note}</p><i>在当前内容中预览 ↗</i></button>)}{mode === 'loaded' && resolvedDetail?.relations.length === 0 && <p className="section-empty">当前没有经过人工确认的对立或互补关系。</p>}</div></section>}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

export default KnowledgePage
