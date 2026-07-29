import { useEffect, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import EvidenceDossier from '../knowledge/EvidenceDossier'
import type {
  KnowledgeNodeDetail,
  NodeAttestation,
  NodeStatus,
} from '../knowledge/types'
import type {
  DiscoveryConsensusNode,
  DiscoveryRelation,
  HarnessCandidate,
  SpotCheckStats,
  WeeklyReport,
  WeeklyScore,
} from './types'

type LoadState = 'loading' | 'loaded' | 'error'

const kindLabels = {
  claim: '判断',
  method: '方法',
  concept: '认知',
} as const

const statusLabels: Record<NodeStatus, string> = {
  active: '活跃',
  corroborated: '多源佐证',
  verified: '已验证',
  contested: '存在争议',
  retired: '已退役',
}

const attestationLabels = {
  restates: '重申',
  refines: '细化',
  supersedes: '修正',
  contradicts: '反驳',
} as const

const outcomeLabels: Record<string, string> = {
  hit: '✓ 命中',
  partial: '½ 部分',
  miss: '✗ 未中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '待复核',
}

const directionLabels: Record<string, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
  range: '↔',
  vol_up: '波动↑',
  vol_down: '波动↓',
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function nodeEvidenceStats(node: KnowledgeNodeDetail) {
  const scores = node.attestations.flatMap((item) => item.scores)
  const hit = scores.filter((score) => score.outcome === 'hit').length
  const partial = scores.filter((score) => score.outcome === 'partial').length
  const miss = scores.filter((score) => score.outcome === 'miss').length
  return {
    attestations: node.attestations.length,
    contents: new Set(node.attestations.map((item) => item.content_id)).size,
    creators: new Set(node.attestations.map((item) => item.creator)).size,
    hit,
    miss,
    partial,
  }
}

function scoredSummary(node: KnowledgeNodeDetail) {
  const stats = nodeEvidenceStats(node)
  const total = stats.hit + stats.partial + stats.miss
  if (total === 0) return '尚无市场评分'
  const rate = ((stats.hit + stats.partial * .5) / total) * 100
  return `${rate.toFixed(0)}% · ${total} 个时点`
}

function NodeEvidenceTrail({
  attestation,
  onOpenEvidence,
}: {
  attestation: NodeAttestation
  onOpenEvidence: (unitId: number) => void
}) {
  return (
    <article className="discovery-attestation">
      <header>
        <span>{attestation.creator}</span>
        <time>{formatDate(attestation.published_at)}</time>
        <b>{attestationLabels[attestation.relation]}</b>
      </header>
      <blockquote>{attestation.quote}</blockquote>
      <p>{attestation.content_title}</p>
      <footer>
        <div>
          {attestation.scores.length > 0
            ? attestation.scores.map((score) => (
                <span className={`outcome-${score.outcome}`} key={`${score.id}-${score.horizon_label}`}>
                  {outcomeLabels[score.outcome] ?? score.outcome} · {score.horizon_label}
                </span>
              ))
            : <span>评分待到期</span>}
        </div>
        <button onClick={() => onOpenEvidence(attestation.unit_id)} type="button">
          核查逐字证据 →
        </button>
      </footer>
    </article>
  )
}

function NodeProposition({
  detail,
  position,
  onOpenEvidence,
}: {
  detail: KnowledgeNodeDetail
  position: 'a' | 'b'
  onOpenEvidence: (unitId: number) => void
}) {
  const evidenceStats = nodeEvidenceStats(detail)
  const scoring = scoredSummary(detail).split(' · ')
  return (
    <section className={`discovery-proposition proposition-${position}`}>
      <header>
        <span>PROPOSITION / {position.toUpperCase()}</span>
        <div>
          <b>{kindLabels[detail.kind]}</b>
          <em>{statusLabels[detail.status]}</em>
        </div>
      </header>
      <h2>{detail.title}</h2>
      <blockquote>{detail.canonical}</blockquote>
      <div className="discovery-proposition-ledger">
        <span><strong>{evidenceStats.creators}</strong><small>信源</small></span>
        <span><strong>{evidenceStats.attestations}</strong><small>提及</small></span>
        <span><strong>{evidenceStats.contents}</strong><small>内容</small></span>
        <span><strong>{scoring[0]}</strong><small>{scoring[1] ?? '市场裁决'}</small></span>
      </div>
      {detail.notes && <p className="discovery-node-notes">{detail.notes}</p>}
      <div className="discovery-evidence-trail">
        <div className="discovery-section-label">
          <span>证据轨迹</span><b>{String(detail.attestations.length).padStart(2, '0')}</b>
        </div>
        {detail.attestations.map((attestation) => (
          <NodeEvidenceTrail
            attestation={attestation}
            key={`${detail.id}-${attestation.unit_id}`}
            onOpenEvidence={onOpenEvidence}
          />
        ))}
      </div>
      <footer className="discovery-proposition-foot">
        <div>{detail.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
        <a href={`#/knowledge?node=${detail.id}&from=discovery`}>打开完整节点 →</a>
      </footer>
    </section>
  )
}

export function RelationDossier({
  evidenceUnitId,
  onCloseEvidence,
  onOpenEvidence,
  relation,
}: {
  evidenceUnitId: number | null
  onCloseEvidence: () => void
  onOpenEvidence: (unitId: number) => void
  relation: DiscoveryRelation
}) {
  const [pair, setPair] = useState<[KnowledgeNodeDetail, KnowledgeNodeDetail] | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setPair(null)
    setState('loading')
    Promise.all([
      apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${relation.a_id}`, { signal: controller.signal }),
      apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${relation.b_id}`, { signal: controller.signal }),
    ]).then((payload) => {
      setPair(payload)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })
    return () => controller.abort()
  }, [relation.a_id, relation.b_id, requestKey])

  if (state === 'loading') {
    return (
      <div aria-label="正在读取关系证据" className="discovery-dossier-loading">
        <span /><i /><i /><b />
      </div>
    )
  }

  if (state === 'error' || !pair) {
    return (
      <div className="discovery-resource-error">
        <span>RELATION EVIDENCE UNAVAILABLE</span>
        <strong>两侧节点档案暂时没有载入</strong>
        <p>关系边仍保留；重试只重新读取节点证据。</p>
        <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取证据</button>
      </div>
    )
  }

  return (
    <>
      <article className={`relation-dossier relation-${relation.relation}`}>
        <header className="relation-dossier-head">
          <div>
            <span>RELATION / {String(relation.id).padStart(2, '0')}</span>
            <b>{relation.relation === 'conflicts' ? 'CONFLICT / CANNOT BOTH HOLD' : 'RELATED / READ TOGETHER'}</b>
          </div>
          <time>{formatDate(relation.created_at)}</time>
        </header>

        <section className="relation-thesis">
          <span>{relation.relation === 'conflicts' ? '对立点是正文' : '合读理由是正文'}</span>
          <p>{relation.note}</p>
        </section>

        <div className="relation-pair">
          <NodeProposition detail={pair[0]} onOpenEvidence={onOpenEvidence} position="a" />
          <div aria-hidden="true" className="relation-axis">
            <i />
            <span>{relation.relation === 'conflicts' ? 'VS' : '＋'}</span>
            <i />
          </div>
          <NodeProposition detail={pair[1]} onOpenEvidence={onOpenEvidence} position="b" />
        </div>
      </article>

      {evidenceUnitId !== null && (
        <EvidenceDossier
          backLabel="返回关系档案"
          onClose={onCloseEvidence}
          parentLabel={relation.relation === 'conflicts' ? 'CONFLICT' : 'RELATION'}
          parentTitle={`#${relation.id}`}
          unitId={evidenceUnitId}
        />
      )}
    </>
  )
}

export function ConsensusDossier({
  evidenceUnitId,
  node,
  onCloseEvidence,
  onOpenEvidence,
}: {
  evidenceUnitId: number | null
  node: DiscoveryConsensusNode
  onCloseEvidence: () => void
  onOpenEvidence: (unitId: number) => void
}) {
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setState('loading')
    apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${node.id}`, {
      signal: controller.signal,
    }).then((payload) => {
      setDetail({ ...node, ...payload })
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })
    return () => controller.abort()
  }, [node, requestKey])

  if (state === 'loading') {
    return <div aria-label="正在读取共识证据" className="discovery-dossier-loading"><span /><i /><i /><b /></div>
  }

  if (state === 'error' || !detail) {
    return (
      <div className="discovery-resource-error">
        <span>CONSENSUS EVIDENCE UNAVAILABLE</span>
        <strong>共识节点暂时没有载入</strong>
        <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取节点</button>
      </div>
    )
  }

  const byCreator = new Map<string, number>()
  detail.attestations.forEach((item) => byCreator.set(item.creator, (byCreator.get(item.creator) ?? 0) + 1))

  return (
    <>
      <article className="consensus-dossier">
        <header className="consensus-dossier-head">
          <div><span>CONSENSUS / NODE {String(detail.id).padStart(3, '0')}</span><b>{statusLabels[detail.status]}</b></div>
          <p>{kindLabels[detail.kind]} · {detail.n_creators} 个独立信源</p>
        </header>
        <section className="consensus-statement">
          <span>{detail.title}</span>
          <blockquote>{detail.canonical}</blockquote>
        </section>
        <section className="consensus-creator-ledger">
          {[...byCreator.entries()].map(([creator, count], index) => (
            <span key={creator}><i>{String(index + 1).padStart(2, '0')}</i><strong>{creator}</strong><b>{count} 条证据</b></span>
          ))}
        </section>
        {detail.notes && (
          <section className="consensus-merge-note">
            <span>归并裁量</span><p>{detail.notes}</p>
          </section>
        )}
        <section className="consensus-evidence">
          <header><span>跨源证据</span><b>{detail.attestations.length} 条</b></header>
          {detail.attestations.map((attestation) => (
            <NodeEvidenceTrail
              attestation={attestation}
              key={`${detail.id}-${attestation.unit_id}`}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </section>
        <footer className="consensus-dossier-foot">
          <div>{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <a href={`#/knowledge?node=${detail.id}&from=discovery`}>打开完整节点 →</a>
        </footer>
      </article>

      {evidenceUnitId !== null && (
        <EvidenceDossier
          backLabel="返回共识档案"
          onClose={onCloseEvidence}
          parentLabel="CONSENSUS"
          parentTitle={`#${detail.id}`}
          unitId={evidenceUnitId}
        />
      )}
    </>
  )
}

function renderClaimedPerformance(value: Record<string, unknown> | null | undefined) {
  if (!value) return null
  const text = Object.values(value)
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .join('；')
  return text || null
}

export function HarnessDossier({ candidate }: { candidate: HarnessCandidate }) {
  const payload = candidate.payload
  const claimed = renderClaimedPerformance(payload.claimed_performance)
  const requirements = payload.data_requirements ?? []
  const rules = payload.rules ?? []
  const overlaps = payload.overlap_with_killed ?? []

  return (
    <article className="harness-dossier">
      <header className="harness-dossier-head">
        <div><span>METHOD / NODE {String(candidate.node_id).padStart(3, '0')}</span><b>CANDIDATE · NOT PREREGISTERED</b></div>
        <p>可回测不等于已经成立</p>
      </header>
      <section className="harness-lead">
        <span>{payload.family ?? 'other'} / TESTABILITY A</span>
        <h2>{candidate.title}</h2>
        <p>{payload.summary ?? candidate.canonical}</p>
      </section>
      <section className="harness-gate">
        <div>
          <span>进入研究管线前</span>
          <strong>仍需冻结假设、样本、成本与否证条件。</strong>
        </div>
        <b>PREREG REQUIRED</b>
      </section>
      <section className="harness-rules">
        <header><span>原始规则</span><b>{rules.length} 条</b></header>
        {rules.length > 0
          ? <ol>{rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
          : <p>该候选没有返回结构化规则。</p>}
      </section>
      <section className="harness-requirements">
        <header><span>数据需求</span><b>{requirements.length}</b></header>
        <div>{requirements.map((item) => <span key={item}>{item}</span>)}</div>
      </section>
      <section className={`harness-overlap ${overlaps.length > 0 ? 'has-overlap' : ''}`}>
        <span>已杀假设重叠</span>
        {overlaps.length > 0
          ? <div>{overlaps.map((item) => <b key={item}>{item}</b>)}</div>
          : <p>当前提取记录未标注与已杀假设重叠；进入研究前仍需人工复核。</p>}
      </section>
      {claimed && (
        <section className="harness-claimed">
          <span>作者自称战绩 · 记录不采信</span>
          <p>{claimed}</p>
        </section>
      )}
      <footer className="harness-dossier-foot">
        <div><span>{candidate.n_attest} 条提及</span><span>{candidate.n_creators} 个信源</span></div>
        <a href={`#/knowledge?node=${candidate.node_id}&from=discovery`}>回到方法证据 →</a>
      </footer>
    </article>
  )
}

function scoreMark(score: WeeklyScore) {
  return outcomeLabels[score.outcome] ?? score.outcome
}

function MarkdownReport({ markdown }: { markdown: string }) {
  return (
    <div className="weekly-markdown">
      {markdown.split('\n').map((line, index) => {
        if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>
        if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>
        if (line.startsWith('- ')) return <p className="markdown-bullet" key={index}>{line.slice(2)}</p>
        if (!line.trim()) return <span className="markdown-space" key={index} />
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

export function WeeklyDossier({
  evidenceUnitId,
  onCloseEvidence,
  onOpenEvidence,
  report,
  spotChecks,
}: {
  evidenceUnitId: number | null
  onCloseEvidence: () => void
  onOpenEvidence: (unitId: number) => void
  report: WeeklyReport
  spotChecks: SpotCheckStats | null
}) {
  const summary = report.summary
  const contentCount = summary.new_contents.reduce((total, row) => total + row.n, 0)
  const unitCount = summary.new_units.reduce((total, row) => total + row.n, 0)
  const checked = spotChecks?.checked ?? summary.spot_check.checked
  const total = spotChecks?.total ?? summary.spot_check.total

  return (
    <>
      <article className="weekly-dossier">
        <header className="weekly-dossier-head">
          <div><span>WEEKLY / KNOWLEDGE DELTA</span><b>{formatDate(report.generated_at, true)}</b></div>
          <p>只记录新增、裁决和状态变化，不把库存重新包装成新闻。</p>
        </header>
        <section className="weekly-ledger">
          <span><strong>{contentCount}</strong><small>新内容</small></span>
          <span><strong>{unitCount}</strong><small>新单元</small></span>
          <span><strong>{summary.new_scores.length}</strong><small>新裁决</small></span>
          <span><strong>{summary.due_next.length}</strong><small>未来 7 天到期</small></span>
        </section>

        <div className="weekly-columns">
          <div>
            <section className="weekly-section weekly-ingest">
              <header><span>知识增量</span><b>INGEST</b></header>
              {summary.new_contents.length > 0
                ? summary.new_contents.map((row) => (
                    <p key={row.name}><strong>{row.name}</strong><span>{row.n} 篇 · {(row.chars / 1000).toFixed(1)}k 字</span></p>
                  ))
                : <p className="weekly-empty">本窗口没有新内容入库。</p>}
              {summary.new_units.length > 0 && (
                <div className="weekly-unit-counts">
                  {summary.new_units.map((row) => <span key={row.kind}>{kindLabels[row.kind]} {row.n}</span>)}
                </div>
              )}
            </section>

            <section className="weekly-section weekly-scores">
              <header><span>新到期裁决</span><b>{summary.new_scores.length}</b></header>
              {summary.new_scores.length > 0
                ? <div>
                    {summary.new_scores.map((score, index) => (
                      <button
                        key={`${score.unit_id}-${score.horizon_label}-${index}`}
                        onClick={() => onOpenEvidence(score.unit_id)}
                        type="button"
                      >
                        <i>{scoreMark(score)}</i>
                        <span><strong>{score.creator} · {score.sym ?? '无规范标的'}</strong><small>{directionLabels[score.dir ?? ''] ?? score.dir ?? '—'} · {score.grade ?? '—'}级 · {score.horizon_label}</small></span>
                        <b>证据 →</b>
                      </button>
                    ))}
                  </div>
                : <p className="weekly-empty">本窗口没有新的机械裁决。</p>}
            </section>
          </div>

          <div>
            <section className="weekly-section weekly-edges">
              <header><span>新关系</span><b>{summary.new_edges.length}</b></header>
              {summary.new_edges.length > 0
                ? summary.new_edges.map((edge, index) => (
                    <article key={`${edge.a_id}-${edge.b_id}-${index}`}>
                      <span>{edge.relation === 'conflicts' ? '对立' : '关联'}</span>
                      <p><a href={`#/knowledge?node=${edge.a_id}&from=discovery`}>{edge.a_title}</a><i>↔</i><a href={`#/knowledge?node=${edge.b_id}&from=discovery`}>{edge.b_title}</a></p>
                    </article>
                  ))
                : <p className="weekly-empty">本窗口没有新增关系边。</p>}
            </section>

            <section className="weekly-section weekly-node-state">
              <header><span>知识状态</span><b>LIFECYCLE</b></header>
              <div>
                {summary.node_status.map((row) => (
                  <span key={row.status}><strong>{row.n}</strong><small>{statusLabels[row.status]}</small></span>
                ))}
              </div>
              {summary.notable_nodes.slice(0, 8).map((node) => (
                <p key={`${node.status}-${node.title}`}><b>{statusLabels[node.status]}</b><span>{node.title}</span></p>
              ))}
            </section>

            <section className="weekly-section weekly-due">
              <header><span>未来 7 天</span><b>DUE</b></header>
              {summary.due_next.length > 0
                ? summary.due_next.map((row, index) => (
                    <button
                      key={`${row.unit_id}-${row.horizon_label}-${index}`}
                      onClick={() => onOpenEvidence(row.unit_id)}
                      type="button"
                    >
                      <time>{row.horizon_label}</time>
                      <span>{row.creator} · {row.sym ?? '无规范标的'} {directionLabels[row.dir ?? ''] ?? row.dir ?? ''}</span>
                      <b>→</b>
                    </button>
                  ))
                : <p className="weekly-empty">未来 7 天没有等待执行的评分时点。</p>}
            </section>
          </div>
        </div>

        <section className="weekly-quality">
          <header>
            <div><span>人工抽查</span><b>{checked}/{total}</b></div>
            <em>{total > 0 ? `${((checked / total) * 100).toFixed(1)}% 覆盖` : '没有可抽查单元'}</em>
          </header>
          {checked === 0 ? (
            <p>当前尚无人工抽查记录。覆盖率为空不代表提取正确，只表示每周抽样流程尚未执行。</p>
          ) : (
            <>
              <div className="weekly-quality-ledger">
                <span>忠实 {spotChecks?.faithful ?? 0}</span>
                <span>不忠实 {spotChecks?.unfaithful ?? 0}</span>
                <span>不明确 {spotChecks?.unclear ?? 0}</span>
              </div>
              {spotChecks?.recent.slice(0, 5).map((row) => (
                <button key={`${row.unit_id}-${row.created_at}`} onClick={() => onOpenEvidence(row.unit_id)} type="button">
                  <b>{row.verdict}</b><span>{row.quote}</span>
                </button>
              ))}
            </>
          )}
        </section>

        <details className="weekly-source-report">
          <summary>查看生成器原始周报</summary>
          <MarkdownReport markdown={report.markdown} />
        </details>
      </article>

      {evidenceUnitId !== null && (
        <EvidenceDossier
          backLabel="返回周报"
          onClose={onCloseEvidence}
          parentLabel="WEEKLY"
          parentTitle={formatDate(report.generated_at)}
          unitId={evidenceUnitId}
        />
      )}
    </>
  )
}
