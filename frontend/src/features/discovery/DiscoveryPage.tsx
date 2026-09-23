import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import { familyLabels } from '../../shared/domain/labels'
import { useModalFocus } from '../../shared/interaction/useModalFocus'
import AppHeader from '../../shared/navigation/AppHeader'
import type { KnowledgeNodeDetail } from '../knowledge/types'
import {
  ConsensusDossier,
  HarnessDossier,
  RelationDossier,
} from './DiscoveryDossier'
import type {
  DiscoveryConsensusNode,
  DiscoveryRelation,
  HarnessCandidate,
  SpotCheckStats,
  WeeklyReport,
} from './types'
import './discovery.css'

type DiscoveryView = 'briefing' | 'relations' | 'consensus' | 'harness'
type LoadState = 'loading' | 'loaded' | 'error'

type DiscoveryLocation = {
  view: DiscoveryView
  relationId: number | null
  consensusId: number | null
  candidateId: number | null
  from: DiscoveryView
}

type RelationProfile = {
  relation: DiscoveryRelation
  a: KnowledgeNodeDetail
  b: KnowledgeNodeDetail
}

type RelationCluster = {
  id: string
  focusId: number
  focusTitle: string
  nodes: Array<{ id: number; title: string }>
  edges: DiscoveryRelation[]
}

const viewLabels: Record<DiscoveryView, string> = {
  briefing: '简报',
  relations: '关系场',
  consensus: '共识',
  harness: '研究候选',
}

function parseNumber(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readLocation(): DiscoveryLocation {
  const query = window.location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const requestedView = params.get('view')
  const view: DiscoveryView = requestedView === 'relations'
    || requestedView === 'consensus'
    || requestedView === 'harness'
    ? requestedView
    : 'briefing'
  const requestedFrom = params.get('from')
  const from: DiscoveryView = requestedFrom === 'relations'
    || requestedFrom === 'consensus'
    || requestedFrom === 'harness'
    ? requestedFrom
    : 'briefing'
  return {
    view,
    relationId: parseNumber(params.get('relation')),
    consensusId: parseNumber(params.get('consensus')),
    candidateId: parseNumber(params.get('candidate')),
    from,
  }
}

function discoveryHref(view: DiscoveryView) {
  return view === 'briefing' ? '#/discovery' : `#/discovery?view=${view}`
}

function detailHref(
  kind: 'relation' | 'consensus' | 'candidate',
  id: number,
  from: DiscoveryView,
) {
  return `#/discovery?${kind}=${id}&from=${from}`
}

function nodeScore(node: KnowledgeNodeDetail) {
  const scores = node.attestations.flatMap((item) => item.scores)
  const hit = scores.filter((score) => score.outcome === 'hit').length
  const partial = scores.filter((score) => score.outcome === 'partial').length
  const miss = scores.filter((score) => score.outcome === 'miss').length
  const total = hit + partial + miss
  return {
    total,
    rate: total > 0 ? Math.round(((hit + partial * .5) / total) * 100) : null,
    creators: new Set(node.attestations.map((item) => item.creator)).size,
    contents: new Set(node.attestations.map((item) => item.content_id)).size,
  }
}

function profilePriority(profile: RelationProfile) {
  const a = nodeScore(profile.a)
  const b = nodeScore(profile.b)
  const bothScored = a.total > 0 && b.total > 0 ? 1000 : 0
  const gap = a.rate !== null && b.rate !== null ? Math.abs(a.rate - b.rate) * 10 : 0
  return bothScored + gap + a.total + b.total
}

function relationScope(profile: RelationProfile | undefined) {
  if (!profile) return '知识张力'
  const aCreators = new Set(profile.a.attestations.map((item) => item.creator))
  const sameCreator = profile.b.attestations.some((item) => aCreators.has(item.creator))
  if (sameCreator) return '同源反转'
  return '跨源对立'
}

function relationSummary(relation: DiscoveryRelation) {
  const prefix = relation.note.match(/^对立命题（([^）]+)）：/u)?.[1] ?? ''
  const cleaned = relation.note
    .replace(/^对立命题（[^）]+）：/u, '')
    .replace(/^互补关系[：:]\s*/u, '')
    .trim()
  const firstSentence = cleaned.split('。')[0]?.trim() ?? relation.note
  if (prefix.includes('同源') && prefix.includes('反转')) {
    return `同一信源在九天内发生立场反转：${firstSentence}。`
  }
  return `${firstSentence}${/[。！？]$/u.test(firstSentence) ? '' : '。'}`
}

function buildRelationClusters(relations: DiscoveryRelation[]): RelationCluster[] {
  const nodeTitles = new Map<number, string>()
  const adjacency = new Map<number, Set<number>>()
  relations.forEach((edge) => {
    nodeTitles.set(edge.a_id, edge.a_title)
    nodeTitles.set(edge.b_id, edge.b_title)
    if (!adjacency.has(edge.a_id)) adjacency.set(edge.a_id, new Set())
    if (!adjacency.has(edge.b_id)) adjacency.set(edge.b_id, new Set())
    adjacency.get(edge.a_id)?.add(edge.b_id)
    adjacency.get(edge.b_id)?.add(edge.a_id)
  })

  const visited = new Set<number>()
  const clusters: RelationCluster[] = []
  adjacency.forEach((_, start) => {
    if (visited.has(start)) return
    const stack = [start]
    const component: number[] = []
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined || visited.has(current)) continue
      visited.add(current)
      component.push(current)
      adjacency.get(current)?.forEach((next) => {
        if (!visited.has(next)) stack.push(next)
      })
    }
    const nodeSet = new Set(component)
    const edges = relations.filter((edge) => nodeSet.has(edge.a_id) && nodeSet.has(edge.b_id))
    const focusId = component.sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0))[0]
    clusters.push({
      id: component.slice().sort((a, b) => a - b).join('-'),
      focusId,
      focusTitle: nodeTitles.get(focusId) ?? '未命名连接簇',
      nodes: component.map((id) => ({ id, title: nodeTitles.get(id) ?? `节点 ${id}` })),
      edges,
    })
  })
  return clusters.sort((a, b) => b.edges.length - a.edges.length || b.nodes.length - a.nodes.length)
}

function groupCandidates(candidates: HarnessCandidate[]) {
  return candidates.reduce<Record<string, HarnessCandidate[]>>((groups, candidate) => {
    const family = candidate.payload.family ?? 'other'
    groups[family] = [...(groups[family] ?? []), candidate]
    return groups
  }, {})
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div aria-label={`正在读取${label}`} className="discovery-v2-loading">
      <span /><i /><i /><b />
      <p>正在整理{label}</p>
    </div>
  )
}

function ErrorBlock({ label, retry }: { label: string; retry: () => void }) {
  return (
    <div className="discovery-v2-error">
      <strong>{label}暂时没有载入</strong>
      <button onClick={retry} type="button">重新读取</button>
    </div>
  )
}

function LocalNavigation({ current }: { current: DiscoveryView }) {
  return (
    <nav aria-label="发现页局部导航" className="page-tabs">
      {(Object.keys(viewLabels) as DiscoveryView[]).map((view) => (
        <a aria-current={current === view ? 'page' : undefined} href={discoveryHref(view)} key={view}>
          {viewLabels[view]}
        </a>
      ))}
    </nav>
  )
}

function FeaturedConflict({
  profile,
  relation,
}: {
  profile: RelationProfile | undefined
  relation: DiscoveryRelation
}) {
  const aScore = profile ? nodeScore(profile.a) : null
  const bScore = profile ? nodeScore(profile.b) : null
  return (
    <article className="discovery-featured-conflict">
      <header>
        <div><span>重点发现</span><b>{relationScope(profile)}</b></div>
      </header>
      <section className="discovery-featured-thesis">
        <span>争点</span>
        <h2>{relationSummary(relation)}</h2>
      </section>
      <div className="discovery-featured-pair">
        <section>
          <span>命题 A</span>
          <h3>{relation.a_title}</h3>
          <footer>
            <b>{aScore?.rate === null || aScore === null ? '尚待裁决' : `${aScore.rate}%`}</b>
            <p>{aScore ? `${aScore.contents} 份内容 · ${aScore.creators} 个信源 · n=${aScore.total}` : '正在读取证据'}</p>
          </footer>
        </section>
        <i aria-hidden="true">↔</i>
        <section>
          <span>命题 B</span>
          <h3>{relation.b_title}</h3>
          <footer>
            <b>{bScore?.rate === null || bScore === null ? '尚待裁决' : `${bScore.rate}%`}</b>
            <p>{bScore ? `${bScore.contents} 份内容 · ${bScore.creators} 个信源 · n=${bScore.total}` : '正在读取证据'}</p>
          </footer>
        </section>
      </div>
      <a className="discovery-featured-open" href={detailHref('relation', relation.id, 'briefing')}>
        <span>查看完整对照、逐字证据和评分轨迹</span><b>→</b>
      </a>
    </article>
  )
}

function ConflictRow({ index, relation, from = 'relations' }: { index: number; relation: DiscoveryRelation; from?: DiscoveryView }) {
  return (
    <a className="discovery-conflict-row" href={detailHref('relation', relation.id, from)}>
      <span>{String(index + 1).padStart(2, '0')}</span>
      <div><b>对立</b><p>{relationSummary(relation)}</p></div>
      <aside><strong>{relation.a_title}</strong><i>VS</i><strong>{relation.b_title}</strong></aside>
      <em>→</em>
    </a>
  )
}

function ClusterCard({ cluster, compact = false }: { cluster: RelationCluster; compact?: boolean }) {
  const visibleEdges = cluster.edges.slice(0, compact ? 3 : 6)
  return (
    <article className="discovery-cluster-card">
      <header>
        <div><span>连接簇</span><b>{cluster.edges.length} 条连接 · {cluster.nodes.length} 个节点</b></div>
        <h3>{cluster.focusTitle}</h3>
      </header>
      <div>
        {visibleEdges.map((edge) => (
          <a href={detailHref('relation', edge.id, 'relations')} key={edge.id}>
            <span>{edge.a_id === cluster.focusId ? edge.b_title : edge.a_title}</span>
            <p>{edge.note}</p>
            <b>→</b>
          </a>
        ))}
      </div>
      {cluster.edges.length > visibleEdges.length && <footer>另有 {cluster.edges.length - visibleEdges.length} 条连接</footer>}
    </article>
  )
}

function ConsensusCard({ node, from = 'consensus' }: { node: DiscoveryConsensusNode; from?: DiscoveryView }) {
  const scored = node.hit + node.partial + node.miss
  return (
    <a className="discovery-consensus-card" href={detailHref('consensus', node.id, from)}>
      <header><span>{node.n_creators} 个独立信源</span><b>{node.n_attest} 条提及</b></header>
      <h3>{node.title}</h3>
      <p>{node.canonical}</p>
      <footer><span>{node.n_contents} 份内容{scored > 0 ? ` · ${scored} 个评分时点` : ' · 尚无评分'}</span><b>查看来源轨道 →</b></footer>
    </a>
  )
}

function CandidateRow({ candidate, from = 'harness' }: { candidate: HarnessCandidate; from?: DiscoveryView }) {
  const rules = candidate.payload.rules?.length ?? 0
  const requirements = candidate.payload.data_requirements?.length ?? 0
  const overlaps = candidate.payload.overlap_with_killed?.length ?? 0
  return (
    <a className="discovery-candidate-row" href={detailHref('candidate', candidate.node_id, from)}>
      <span>{familyLabels[candidate.payload.family ?? 'other'] ?? candidate.payload.family ?? '其他'}</span>
      <div><h3>{candidate.title}</h3><p>{candidate.payload.summary ?? candidate.canonical}</p></div>
      <aside><b>{rules} 条规则</b><b>{requirements} 项数据</b><b className={overlaps > 0 ? 'has-warning' : ''}>{overlaps > 0 ? `${overlaps} 项失败重叠` : '待人工查重'}</b></aside>
      <em>→</em>
    </a>
  )
}

function DeltaDialog({
  close,
  restoreRef,
  report,
  spotChecks,
  state,
  retry,
}: {
  close: () => void
  restoreRef: React.RefObject<HTMLElement | null>
  report: WeeklyReport | null
  spotChecks: SpotCheckStats | null
  state: LoadState
  retry: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocus(dialogRef, true, close, restoreRef)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const summary = report?.summary
  const contents = summary?.new_contents.reduce((total, row) => total + row.n, 0) ?? 0
  const units = summary?.new_units.reduce((total, row) => total + row.n, 0) ?? 0
  return (
    <div className="discovery-delta-overlay" onMouseDown={close} role="presentation">
      <section aria-label="本期知识变化" aria-modal="true" className="discovery-delta-dialog" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog">
        <header>
          <div><h2>本期变化 <small>近 7 天</small></h2></div>
          <button aria-label="关闭本期变化" autoFocus onClick={close} type="button">×</button>
        </header>
        {state === 'loading' && <LoadingBlock label="本期变化" />}
        {state === 'error' && <ErrorBlock label="本期变化" retry={retry} />}
        {state === 'loaded' && summary && (
          <>
            <p className="discovery-delta-note">这里记录入库和系统写入，不把回填数据表述成新发布内容。</p>
            <div className="discovery-delta-ledger">
              <span><strong>{contents}</strong><small>本期入库内容</small></span>
              <span><strong>{units}</strong><small>知识单元</small></span>
              <span><strong>{summary.new_edges.length}</strong><small>新增关系</small></span>
              <span><strong>{summary.new_scores.length}</strong><small>评分写入</small></span>
            </div>
            <div className="discovery-delta-grid">
              <section>
                <header><span>入库来源</span><b>{contents} 篇</b></header>
                {summary.new_contents.slice(0, 5).map((row) => (
                  <p key={row.name}><strong>{row.name}</strong><span>{row.n} 篇 · {(row.chars / 1000).toFixed(1)}k 字</span></p>
                ))}
              </section>
              <section>
                <header><span>需要继续处理</span></header>
                <a href="#/verification"><strong>{summary.due_next.length} 个时点将在未来 7 天到期</strong><span>进入验证中心 →</span></a>
                <a href="#/verification"><strong>{summary.new_scores.length} 个评分时点已经写入</strong><span>查看验证记录 →</span></a>
                <p><strong>人工抽查 {spotChecks?.checked ?? summary.spot_check.checked}/{spotChecks?.total ?? summary.spot_check.total}</strong><span>{spotChecks ? `${spotChecks.unfaithful} 不忠实 · ${spotChecks.unclear} 不明确` : '查看覆盖状态'}</span></p>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function RecordNavigation({
  backView,
  current,
  label,
  nextHref,
  previousHref,
}: {
  backView: DiscoveryView
  current: string
  label: string
  nextHref?: string
  previousHref?: string
}) {
  return (
    <header className="discovery-record-nav">
      <a href={discoveryHref(backView)}>← 返回{viewLabels[backView]}</a>
      <p><span>{label}</span><b>{current}</b></p>
      <nav aria-label="档案翻页">
        {previousHref ? <a href={previousHref}>上一条</a> : <span>上一条</span>}
        {nextHref ? <a href={nextHref}>下一条</a> : <span>下一条</span>}
      </nav>
    </header>
  )
}

function DiscoveryPage() {
  const [location, setLocation] = useState(readLocation)
  const [query, setQuery] = useState('')
  const [relationMode, setRelationMode] = useState<'conflicts' | 'relates'>('conflicts')
  const [clusterLimit, setClusterLimit] = useState(() => window.matchMedia('(max-width: 760px)').matches ? 4 : 8)
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(() => new Set())
  const [deltaOpen, setDeltaOpen] = useState(false)
  const deltaTriggerRef = useRef<HTMLElement | null>(null)
  const previousViewScroll = useRef(0)
  const previousWasDetail = useRef(false)
  const previousView = useRef(location.view)

  const [relations, setRelations] = useState<DiscoveryRelation[]>([])
  const [relationState, setRelationState] = useState<LoadState>('loading')
  const [relationRequest, setRelationRequest] = useState(0)
  const [profiles, setProfiles] = useState<RelationProfile[]>([])
  const [profileState, setProfileState] = useState<LoadState>('loading')

  const [consensus, setConsensus] = useState<DiscoveryConsensusNode[]>([])
  const [consensusState, setConsensusState] = useState<LoadState>('loading')
  const [consensusRequest, setConsensusRequest] = useState(0)

  const [candidates, setCandidates] = useState<HarnessCandidate[]>([])
  const [candidateState, setCandidateState] = useState<LoadState>('loading')
  const [candidateRequest, setCandidateRequest] = useState(0)

  const [spotChecks, setSpotChecks] = useState<SpotCheckStats | null>(null)
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null)
  const [weeklyState, setWeeklyState] = useState<LoadState>('loading')
  const [weeklyRequest, setWeeklyRequest] = useState(0)

  useEffect(() => {
    const onHashChange = () => setLocation(readLocation())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const detailOpen = location.relationId !== null || location.consensusId !== null || location.candidateId !== null
    if (detailOpen && !previousWasDetail.current) {
      previousViewScroll.current = window.scrollY
      window.scrollTo({ top: 0 })
    } else if (!detailOpen && previousWasDetail.current) {
      requestAnimationFrame(() => window.scrollTo({ top: previousViewScroll.current }))
    } else if (!detailOpen && previousView.current !== location.view) {
      window.scrollTo({ top: 0 })
    }
    previousWasDetail.current = detailOpen
    previousView.current = location.view
  }, [location])

  useEffect(() => {
    const controller = new AbortController()
    setRelationState('loading')
    apiJson<DiscoveryRelation[]>('/knowledge/relations', { signal: controller.signal })
      .then((rows) => { setRelations(rows); setRelationState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setRelationState('error') })
    return () => controller.abort()
  }, [relationRequest])

  const conflicts = useMemo(() => relations.filter((row) => row.relation === 'conflicts'), [relations])
  const related = useMemo(() => relations.filter((row) => row.relation === 'relates'), [relations])
  const conflictKey = conflicts.map((relation) => `${relation.id}:${relation.a_id}:${relation.b_id}`).join(',')

  useEffect(() => {
    if (!conflictKey) {
      setProfiles([])
      setProfileState('loaded')
      return
    }
    const controller = new AbortController()
    setProfileState('loading')
    Promise.all(conflicts.map(async (relation) => {
      const [a, b] = await Promise.all([
        apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${relation.a_id}`, { signal: controller.signal }),
        apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${relation.b_id}`, { signal: controller.signal }),
      ])
      return { relation, a, b }
    })).then((rows) => {
      setProfiles(rows.sort((a, b) => profilePriority(b) - profilePriority(a)))
      setProfileState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setProfileState('error')
    })
    return () => controller.abort()
  }, [conflictKey, conflicts])

  useEffect(() => {
    const controller = new AbortController()
    setConsensusState('loading')
    apiJson<DiscoveryConsensusNode[]>('/knowledge/nodes?cross_source=true&limit=100', { signal: controller.signal })
      .then((rows) => { setConsensus(rows); setConsensusState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setConsensusState('error') })
    return () => controller.abort()
  }, [consensusRequest])

  useEffect(() => {
    const controller = new AbortController()
    setCandidateState('loading')
    apiJson<HarnessCandidate[]>('/knowledge/harness-candidates', { signal: controller.signal })
      .then((rows) => { setCandidates(rows); setCandidateState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setCandidateState('error') })
    return () => controller.abort()
  }, [candidateRequest])

  useEffect(() => {
    const controller = new AbortController()
    setWeeklyState('loading')
    Promise.all([
      apiJson<WeeklyReport>('/knowledge/weekly?days=7', { signal: controller.signal }),
      apiJson<SpotCheckStats>('/knowledge/spot-checks', { signal: controller.signal }),
    ]).then(([report, checks]) => {
      setWeekly(report)
      setSpotChecks(checks)
      setWeeklyState('loaded')
    }).catch(() => { if (!controller.signal.aborted) setWeeklyState('error') })
    return () => controller.abort()
  }, [weeklyRequest])

  const featuredProfile = profiles[0]
  const featuredRelation = featuredProfile?.relation ?? conflicts[0]
  const clusters = useMemo(() => buildRelationClusters(related), [related])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleConflicts = conflicts.filter((relation) => `${relation.note} ${relation.a_title} ${relation.b_title}`.toLocaleLowerCase().includes(normalizedQuery))
  const visibleClusters = clusters.filter((cluster) => `${cluster.focusTitle} ${cluster.edges.map((edge) => `${edge.note} ${edge.a_title} ${edge.b_title}`).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery))
  const visibleConsensus = consensus.filter((node) => `${node.title} ${node.canonical} ${node.tags.join(' ')}`.toLocaleLowerCase().includes(normalizedQuery))
  const visibleCandidates = candidates.filter((candidate) => `${candidate.title} ${candidate.canonical} ${JSON.stringify(candidate.payload)}`.toLocaleLowerCase().includes(normalizedQuery))
  const candidateGroups = groupCandidates(visibleCandidates)

  useEffect(() => {
    if (openFamilies.size > 0 || candidates.length === 0) return
    setOpenFamilies(new Set(Object.keys(groupCandidates(candidates)).slice(0, 1)))
  }, [candidates, openFamilies.size])

  const relationDetail = location.relationId !== null ? relations.find((row) => row.id === location.relationId) : null
  const consensusDetail = location.consensusId !== null ? consensus.find((row) => row.id === location.consensusId) : null
  const candidateDetail = location.candidateId !== null ? candidates.find((row) => row.node_id === location.candidateId) : null

  if (location.relationId !== null) {
    const index = relations.findIndex((row) => row.id === location.relationId)
    return (
      <div className="discovery-record-page app-page">
        <RecordNavigation
          backView={location.from}
          current={index >= 0 ? `${String(index + 1).padStart(2, '0')} / ${String(relations.length).padStart(2, '0')}` : '—'}
          label="关系档案"
          nextHref={relations[index + 1] ? detailHref('relation', relations[index + 1].id, location.from) : undefined}
          previousHref={relations[index - 1] ? detailHref('relation', relations[index - 1].id, location.from) : undefined}
        />
        <main className="discovery-record-body">
          {relationState === 'loading' && <LoadingBlock label="关系档案" />}
          {relationState === 'error' && <ErrorBlock label="关系档案" retry={() => setRelationRequest((value) => value + 1)} />}
          {relationState === 'loaded' && relationDetail && <RelationDossier relation={relationDetail} />}
          {relationState === 'loaded' && !relationDetail && <ErrorBlock label="指定关系" retry={() => { window.location.hash = discoveryHref(location.from) }} />}
        </main>
      </div>
    )
  }

  if (location.consensusId !== null) {
    const index = consensus.findIndex((row) => row.id === location.consensusId)
    return (
      <div className="discovery-record-page app-page">
        <RecordNavigation
          backView={location.from}
          current={index >= 0 ? `${String(index + 1).padStart(2, '0')} / ${String(consensus.length).padStart(2, '0')}` : '—'}
          label="共识档案"
          nextHref={consensus[index + 1] ? detailHref('consensus', consensus[index + 1].id, location.from) : undefined}
          previousHref={consensus[index - 1] ? detailHref('consensus', consensus[index - 1].id, location.from) : undefined}
        />
        <main className="discovery-record-body">
          {consensusState === 'loading' && <LoadingBlock label="共识档案" />}
          {consensusState === 'error' && <ErrorBlock label="共识档案" retry={() => setConsensusRequest((value) => value + 1)} />}
          {consensusState === 'loaded' && consensusDetail && <ConsensusDossier node={consensusDetail} />}
          {consensusState === 'loaded' && !consensusDetail && <ErrorBlock label="指定共识" retry={() => { window.location.hash = discoveryHref(location.from) }} />}
        </main>
      </div>
    )
  }

  if (location.candidateId !== null) {
    const index = candidates.findIndex((row) => row.node_id === location.candidateId)
    return (
      <div className="discovery-record-page app-page">
        <RecordNavigation
          backView={location.from}
          current={index >= 0 ? `${String(index + 1).padStart(2, '0')} / ${String(candidates.length).padStart(2, '0')}` : '—'}
          label="研究候选"
          nextHref={candidates[index + 1] ? detailHref('candidate', candidates[index + 1].node_id, location.from) : undefined}
          previousHref={candidates[index - 1] ? detailHref('candidate', candidates[index - 1].node_id, location.from) : undefined}
        />
        <main className="discovery-record-body">
          {candidateState === 'loading' && <LoadingBlock label="研究候选" />}
          {candidateState === 'error' && <ErrorBlock label="研究候选" retry={() => setCandidateRequest((value) => value + 1)} />}
          {candidateState === 'loaded' && candidateDetail && <HarnessDossier candidate={candidateDetail} />}
          {candidateState === 'loaded' && !candidateDetail && <ErrorBlock label="指定候选" retry={() => { window.location.hash = discoveryHref(location.from) }} />}
        </main>
      </div>
    )
  }

  return (
    <div className="discovery-page discovery-v2 app-page">
      <AppHeader current="discovery" onSearch={() => { window.location.hash = '#/knowledge?search=1' }} />
      <main className="discovery-v2-stage">
        <header className="page-head">
          <h1>发现</h1>
          <LocalNavigation current={location.view} />
          <div className="page-head-actions">
            <dl aria-label="发现规模" className="page-stats">
              <div><dt>对立</dt><dd>{relationState === 'loaded' ? conflicts.length : '—'}</dd></div>
              <div><dt>连接</dt><dd>{relationState === 'loaded' ? related.length : '—'}</dd></div>
              <div><dt>跨源共识</dt><dd>{consensusState === 'loaded' ? consensus.length : '—'}</dd></div>
              <div><dt>研究候选</dt><dd>{candidateState === 'loaded' ? candidates.length : '—'}</dd></div>
            </dl>
            <button
              aria-label="本期变化"
              className="btn"
              onClick={() => {
                deltaTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
                setDeltaOpen(true)
              }}
              type="button"
            >
              本期变化 <span aria-hidden="true">↗</span>
            </button>
          </div>
        </header>

        {location.view === 'briefing' && (
          <div className="discovery-briefing">
            {relationState === 'loading' || profileState === 'loading' ? <LoadingBlock label="重点发现" /> : null}
            {relationState === 'error' ? <ErrorBlock label="关系" retry={() => setRelationRequest((value) => value + 1)} /> : null}
            {relationState === 'loaded' && featuredRelation && profileState !== 'loading' && (
              <FeaturedConflict profile={featuredProfile} relation={featuredRelation} />
            )}

            <section className="discovery-brief-section discovery-open-conflicts">
              <header><div><h2>尚待继续裁决的张力</h2></div><a href="#/discovery?view=relations">查看全部对立 →</a></header>
              <div>
                {conflicts.filter((row) => row.id !== featuredRelation?.id).slice(0, 3).map((relation, index) => (
                  <ConflictRow from="briefing" index={index} key={relation.id} relation={relation} />
                ))}
              </div>
            </section>

            <section className="discovery-brief-section discovery-cluster-preview">
              <header><div><h2>正在形成的连接簇</h2></div><a href="#/discovery?view=relations">进入关系场 →</a></header>
              <div>{clusters.slice(0, 2).map((cluster) => <ClusterCard cluster={cluster} compact key={cluster.id} />)}</div>
            </section>

            <section className="discovery-brief-section discovery-consensus-preview">
              <header><div><h2>跨来源的汇合</h2></div><a href="#/discovery?view=consensus">查看全部共识 →</a></header>
              <div>{consensus.slice(0, 3).map((node) => <ConsensusCard from="briefing" key={node.id} node={node} />)}</div>
            </section>

            <section className="discovery-brief-section discovery-candidate-preview">
              <header><div><h2>可进入研究准备的候选</h2></div><a href="#/discovery?view=harness">查看候选池 →</a></header>
              <div>{candidates.slice(0, 3).map((candidate) => <CandidateRow candidate={candidate} from="briefing" key={candidate.node_id} />)}</div>
            </section>
          </div>
        )}

        {location.view === 'relations' && (
          <section className="discovery-index-view">
            <header className="discovery-index-head">
              <div aria-label="关系类型" className="chips" role="group">
                <button aria-pressed={relationMode === 'conflicts'} onClick={() => setRelationMode('conflicts')} type="button">对立<small>{conflicts.length}</small></button>
                <button aria-pressed={relationMode === 'relates'} onClick={() => { setRelationMode('relates'); setClusterLimit(window.matchMedia('(max-width: 760px)').matches ? 4 : 8) }} type="button">连接簇<small>{clusters.length}</small></button>
              </div>
              <label className="field-search"><span aria-hidden="true">⌕</span><input aria-label="检索关系" onChange={(event) => setQuery(event.target.value)} placeholder="命题或关系理由" value={query} />{query && <button aria-label="清空检索" onClick={() => setQuery('')} type="button">×</button>}</label>
            </header>
            {relationState === 'loading' && <LoadingBlock label="关系" />}
            {relationState === 'error' && <ErrorBlock label="关系" retry={() => setRelationRequest((value) => value + 1)} />}
            {relationState === 'loaded' && relationMode === 'conflicts' && <div className="discovery-conflict-index">{visibleConflicts.map((relation, index) => <ConflictRow index={index} key={relation.id} relation={relation} />)}</div>}
            {relationState === 'loaded' && relationMode === 'relates' && (
              <>
                <div className="discovery-cluster-index">{visibleClusters.slice(0, clusterLimit).map((cluster) => <ClusterCard cluster={cluster} key={cluster.id} />)}</div>
                {visibleClusters.length > clusterLimit && <button className="discovery-load-more" onClick={() => setClusterLimit((value) => value + 8)} type="button">继续查看连接簇 <b>{visibleClusters.length - clusterLimit}</b></button>}
              </>
            )}
            {relationState === 'loaded' && ((relationMode === 'conflicts' && visibleConflicts.length === 0) || (relationMode === 'relates' && visibleClusters.length === 0)) && <p className="discovery-empty">没有匹配的关系。</p>}
          </section>
        )}

        {location.view === 'consensus' && (
          <section className="discovery-index-view">
            <header className="discovery-index-head">
              <label className="field-search"><span aria-hidden="true">⌕</span><input aria-label="检索共识" onChange={(event) => setQuery(event.target.value)} placeholder="共识与主题" value={query} />{query && <button aria-label="清空检索" onClick={() => setQuery('')} type="button">×</button>}</label>
            </header>
            {consensusState === 'loading' && <LoadingBlock label="跨源共识" />}
            {consensusState === 'error' && <ErrorBlock label="跨源共识" retry={() => setConsensusRequest((value) => value + 1)} />}
            {consensusState === 'loaded' && <div className="discovery-consensus-index">{visibleConsensus.map((node) => <ConsensusCard key={node.id} node={node} />)}</div>}
            {consensusState === 'loaded' && visibleConsensus.length === 0 && <p className="discovery-empty">没有匹配的共识节点。</p>}
          </section>
        )}

        {location.view === 'harness' && (
          <section className="discovery-index-view">
            <header className="discovery-index-head">
              <label className="field-search"><span aria-hidden="true">⌕</span><input aria-label="检索研究候选" onChange={(event) => setQuery(event.target.value)} placeholder="方法、规则或数据需求" value={query} />{query && <button aria-label="清空检索" onClick={() => setQuery('')} type="button">×</button>}</label>
            </header>
            {candidateState === 'loading' && <LoadingBlock label="研究候选" />}
            {candidateState === 'error' && <ErrorBlock label="研究候选" retry={() => setCandidateRequest((value) => value + 1)} />}
            {candidateState === 'loaded' && (
              <div className="discovery-family-index">
                {Object.entries(candidateGroups).map(([family, rows]) => (
                  <details
                    key={family}
                    onToggle={(event) => {
                      const shouldOpen = event.currentTarget.open
                      setOpenFamilies((current) => {
                        if (current.has(family) === shouldOpen) return current
                        const next = new Set(current)
                        if (shouldOpen) next.add(family)
                        else next.delete(family)
                        return next
                      })
                    }}
                    open={openFamilies.has(family)}
                  >
                    <summary><h3>{familyLabels[family] ?? family}</h3><span>{rows.length} 个候选</span><b>展开</b></summary>
                    <div>{rows.map((candidate) => <CandidateRow candidate={candidate} key={candidate.node_id} />)}</div>
                  </details>
                ))}
              </div>
            )}
            {candidateState === 'loaded' && visibleCandidates.length === 0 && <p className="discovery-empty">没有匹配的研究候选。</p>}
          </section>
        )}
      </main>


      {deltaOpen && <DeltaDialog close={() => setDeltaOpen(false)} report={weekly} restoreRef={deltaTriggerRef} retry={() => setWeeklyRequest((value) => value + 1)} spotChecks={spotChecks} state={weeklyState} />}
    </div>
  )
}

export default DiscoveryPage
