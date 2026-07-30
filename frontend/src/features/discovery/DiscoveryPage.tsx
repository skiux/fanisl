import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import { nodeHeading, nodeStatusLabels } from '../../shared/knowledge/labels'
import '../../shared/layout/chassis.css'
import { HarnessDossier, RelationDossier, WeeklyDossier } from './DiscoveryDossier'
import type { KnowledgeNode } from '../knowledge/types'
import type {
  DiscoveryRelation,
  HarnessCandidate,
  SpotCheckStats,
  WeeklyReport,
} from './types'
import './discovery.css'

type LoadState = 'loading' | 'loaded' | 'error'

function useNodeIndex() {
  const [nodes, setNodes] = useState<Map<number, KnowledgeNode>>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal })
      .then((rows) => setNodes(new Map(rows.map((row) => [row.id, row]))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  return nodes
}

/** 一条关系边：理由是正文，两侧命题并置，都不折叠。 */
function RelationBlock({
  expanded,
  nodes,
  onToggle,
  relation,
}: {
  expanded: boolean
  nodes: Map<number, KnowledgeNode>
  onToggle: () => void
  relation: DiscoveryRelation
}) {
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)
  const a = nodes.get(relation.a_id)
  const b = nodes.get(relation.b_id)
  const isConflict = relation.relation === 'conflicts'

  const side = (
    node: KnowledgeNode | undefined,
    title: string,
    id: number,
  ) => {
    const head = node ? nodeHeading(node) : { heading: title, body: '', needsBody: false }
    return (
      <div className="edge-side">
        <a href={`#/knowledge?node=${id}&from=discovery`}>{head.heading}</a>
        {head.needsBody && <p>{head.body}</p>}
        <span>
          {node ? nodeStatusLabels[node.status] : '节点摘要待载入'}
          {node && node.n_creators >= 2 ? ' · 跨源' : ''}
          {node ? ` · ${node.n_attest} 次提及` : ''}
        </span>
      </div>
    )
  }

  return (
    <article className={`edge-block ${isConflict ? 'edge-conflict' : 'edge-relates'}`}>
      <p className="edge-note">{relation.note}</p>
      <div className="edge-pair">
        {side(a, relation.a_title, relation.a_id)}
        <i aria-hidden="true">{isConflict ? '不能同真' : '合读'}</i>
        {side(b, relation.b_title, relation.b_id)}
      </div>
      <button className="edge-expand" onClick={onToggle} type="button">
        {expanded ? '收起两侧证据' : '展开两侧证据轨迹'}
      </button>
      {expanded && (
        <div className="edge-dossier">
          <RelationDossier
            evidenceUnitId={evidenceUnitId}
            onCloseEvidence={() => setEvidenceUnitId(null)}
            onOpenEvidence={setEvidenceUnitId}
            relation={relation}
          />
        </div>
      )}
    </article>
  )
}

function DiscoveryPage() {
  const nodes = useNodeIndex()
  const [relations, setRelations] = useState<DiscoveryRelation[]>([])
  const [relationState, setRelationState] = useState<LoadState>('loading')
  const [relationRequestKey, setRelationRequestKey] = useState(0)
  const [expandedEdge, setExpandedEdge] = useState<number | null>(null)

  const [candidates, setCandidates] = useState<HarnessCandidate[]>([])
  const [candidateState, setCandidateState] = useState<LoadState>('loading')
  const [openCandidate, setOpenCandidate] = useState<number | null>(null)

  const [spotChecks, setSpotChecks] = useState<SpotCheckStats | null>(null)

  const [weekDays, setWeekDays] = useState(7)
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null)
  const [weeklyState, setWeeklyState] = useState<LoadState>('loading')
  const [weeklyOpen, setWeeklyOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setRelationState('loading')
    apiJson<DiscoveryRelation[]>('/knowledge/relations', { signal: controller.signal })
      .then((rows) => {
        setRelations(rows)
        setRelationState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setRelationState('error')
      })
    return () => controller.abort()
  }, [relationRequestKey])

  useEffect(() => {
    const controller = new AbortController()
    apiJson<HarnessCandidate[]>('/knowledge/harness-candidates', { signal: controller.signal })
      .then((rows) => {
        setCandidates(rows)
        setCandidateState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setCandidateState('error')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    apiJson<SpotCheckStats>('/knowledge/spot-checks', { signal: controller.signal })
      .then(setSpotChecks)
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!weeklyOpen) return
    const controller = new AbortController()
    setWeeklyState('loading')
    apiJson<WeeklyReport>(`/knowledge/weekly?days=${weekDays}`, { signal: controller.signal })
      .then((payload) => {
        setWeekly(payload)
        setWeeklyState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setWeeklyState('error')
      })
    return () => controller.abort()
  }, [weekDays, weeklyOpen])

  const conflicts = useMemo(() => relations.filter((row) => row.relation === 'conflicts'), [relations])
  const related = useMemo(() => relations.filter((row) => row.relation === 'relates'), [relations])
  const crossSource = useMemo(
    () => [...nodes.values()].filter((node) => node.n_creators >= 2),
    [nodes],
  )

  const toggleEdge = (id: number) => setExpandedEdge((current) => (current === id ? null : id))

  return (
    <div className="page-shell discovery-page">
      <div aria-hidden="true" className="discovery-material" />
      <AppHeader current="discovery" onSearch={() => { window.location.hash = '#/knowledge?search=1' }} />

      <main className="page-stage narrow">
        <header className="page-masthead">
          <h1>发现</h1>
          <div className="page-facts">
            <span><b>{conflicts.length}</b> 条对立</span><i />
            <span><b>{related.length}</b> 条关联</span><i />
            <span><b>{crossSource.length}</b> 个跨源节点</span><i />
            <span><b>{candidates.length}</b> 个可回测候选</span>
          </div>
        </header>

        <div className="page-body no-rail">
          <div className="page-main">
            {relationState === 'loading' && (
              <div aria-label="正在读取关系边" className="page-skeleton"><i /><i /></div>
            )}

            {relationState === 'error' && (
              <div className="page-error">
                <strong>关系边暂时没有载入</strong>
                <p>页面不会用样板关系替代真实知识。</p>
                <button onClick={() => setRelationRequestKey((value) => value + 1)} type="button">重新读取</button>
              </div>
            )}

            {relationState === 'loaded' && (
              <>
                <section className="discovery-band band-conflict">
                  <header>
                    <h2>对立命题</h2>
                    <p>两条命题不能同真，且各有独立论证。全库最稀缺的一类。</p>
                  </header>
                  {conflicts.length > 0 ? conflicts.map((relation) => (
                    <RelationBlock
                      expanded={expandedEdge === relation.id}
                      key={relation.id}
                      nodes={nodes}
                      onToggle={() => toggleEdge(relation.id)}
                      relation={relation}
                    />
                  )) : (
                    <div className="page-empty">
                      <strong>还没有确认的对立关系</strong>
                      <p>对立需要两条命题各有独立论证且不能同真；归并时从严判定，信源增多后才会出现。</p>
                    </div>
                  )}
                </section>

                <section className="discovery-band">
                  <header>
                    <h2>关联</h2>
                    <p>读其一应看另一：问题与解法、识别与应对、跨源印证。</p>
                  </header>
                  {related.length > 0 ? related.map((relation) => (
                    <RelationBlock
                      expanded={expandedEdge === relation.id}
                      key={relation.id}
                      nodes={nodes}
                      onToggle={() => toggleEdge(relation.id)}
                      relation={relation}
                    />
                  )) : (
                    <div className="page-empty">
                      <strong>还没有确认的关联关系</strong>
                      <p>关联宁缺勿滥，只在合读确有增益时建立。</p>
                    </div>
                  )}
                </section>
              </>
            )}

            <section className="discovery-band">
              <header>
                <h2>跨源节点</h2>
                <p>同一命题被两位以上独立信源表达。共识由提及形成，不另建关系边。</p>
              </header>
              {crossSource.length > 0 ? (
                <ul className="cross-list">
                  {crossSource.map((node) => (
                    <li key={node.id}>
                      <a href={`#/knowledge?node=${node.id}&from=discovery`}>{nodeHeading(node).heading}</a>
                      <p>{node.canonical}</p>
                      <span>{node.n_creators} 位信源 · {node.n_attest} 次提及 · {node.n_contents} 篇内容</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="page-empty">
                  <strong>暂无跨源节点</strong>
                  <p>当前只有 2 位信源，跨源重合需要更多信源或更长的历史回填。</p>
                </div>
              )}
            </section>

            <section className="discovery-band">
              <header>
                <h2>可回测方法候选</h2>
                <p>可回测不等于成立。进入研究管线前仍需冻结假设、样本、成本与否证条件。</p>
              </header>
              {candidateState === 'loading' && <div className="page-skeleton"><i /></div>}
              {candidateState === 'loaded' && candidates.map((candidate) => (
                <article className="candidate-block" key={candidate.node_id}>
                  <a href={`#/knowledge?node=${candidate.node_id}&from=discovery`}>{nodeHeading(candidate).heading}</a>
                  <p>{candidate.payload.summary ?? candidate.canonical}</p>
                  <span>
                    {candidate.payload.family ?? 'other'} · 可回测 ·{' '}
                    {candidate.payload.data_requirements?.length ?? 0} 项数据需求
                  </span>
                  <button
                    onClick={() => setOpenCandidate((current) => (current === candidate.node_id ? null : candidate.node_id))}
                    type="button"
                  >
                    {openCandidate === candidate.node_id ? '收起规则与数据需求' : '展开规则与数据需求'}
                  </button>
                  {openCandidate === candidate.node_id && (
                    <div className="candidate-dossier"><HarnessDossier candidate={candidate} /></div>
                  )}
                </article>
              ))}
              {candidateState === 'error' && (
                <div className="page-error"><strong>候选清单暂时没有载入</strong></div>
              )}
            </section>

            <section className="discovery-band band-ops">
              <header>
                <h2>运营</h2>
                <p>提取忠实度抽查与窗口增量，更新以周计。</p>
              </header>
              <div className="ops-row">
                <div>
                  <strong>
                    {spotChecks ? `${spotChecks.checked} / ${spotChecks.total}` : '—'}
                  </strong>
                  <span>人工抽查覆盖</span>
                  <p>
                    {spotChecks && spotChecks.checked === 0
                      ? '尚未执行抽样。抽查用于核对提取是否忠实于原文，覆盖为 0 时提取质量没有独立证据。'
                      : spotChecks
                        ? `忠实 ${spotChecks.faithful} · 不忠实 ${spotChecks.unfaithful} · 存疑 ${spotChecks.unclear}`
                        : '读取中'}
                  </p>
                </div>
                <div>
                  <strong>{weekDays} 天</strong>
                  <span>增量窗口</span>
                  <div className="ops-window">
                    {[7, 14, 30].map((days) => (
                      <button
                        aria-pressed={weekDays === days}
                        key={days}
                        onClick={() => { setWeekDays(days); setWeeklyOpen(true) }}
                        type="button"
                      >
                        {days} 天
                      </button>
                    ))}
                  </div>
                  <button className="ops-toggle" onClick={() => setWeeklyOpen(!weeklyOpen)} type="button">
                    {weeklyOpen ? '收起增量报告' : '生成增量报告'}
                  </button>
                </div>
              </div>
              {weeklyOpen && weeklyState === 'loading' && <div className="page-skeleton"><i /></div>}
              {weeklyOpen && weeklyState === 'error' && (
                <div className="page-error"><strong>增量报告暂时没有载入</strong></div>
              )}
              {weeklyOpen && weeklyState === 'loaded' && weekly && (
                <div className="weekly-inline">
                  <WeeklyDossier
                    evidenceUnitId={null}
                    onCloseEvidence={() => undefined}
                    onOpenEvidence={() => undefined}
                    report={weekly}
                    spotChecks={spotChecks}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

export default DiscoveryPage
