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
  showEvidence = true,
}: {
  detail: KnowledgeNodeDetail
  position: 'a' | 'b'
  onOpenEvidence: (unitId: number) => void
  showEvidence?: boolean
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
      {showEvidence && (
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
      )}
      <footer className="discovery-proposition-foot">
        <div>{detail.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
        <a href={`#/knowledge?node=${detail.id}&from=discovery`}>打开完整节点 →</a>
      </footer>
    </section>
  )
}

export function RelationDossier({
  relation,
}: {
  relation: DiscoveryRelation
}) {
  const [pair, setPair] = useState<[KnowledgeNodeDetail, KnowledgeNodeDetail] | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [tab, setTab] = useState<'compare' | 'evidence' | 'verdict' | 'context'>('compare')
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)

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

  useEffect(() => {
    setTab('compare')
    setEvidenceUnitId(null)
  }, [relation.id])

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
          <p>{relationSummary(relation)}</p>
        </section>

        <nav aria-label="关系档案内容" className="relation-dossier-tabs">
          {([
            ['compare', '观点对照'],
            ['evidence', '证据轨迹'],
            ['verdict', '市场裁决'],
            ['context', '关系上下文'],
          ] as const).map(([key, label]) => (
            <button aria-pressed={tab === key} key={key} onClick={() => setTab(key)} type="button">{label}</button>
          ))}
        </nav>

        {tab === 'compare' && (
          <div className="relation-pair relation-pair-summary">
            <NodeProposition detail={pair[0]} onOpenEvidence={setEvidenceUnitId} position="a" showEvidence={false} />
            <div aria-hidden="true" className="relation-axis">
              <i />
              <span>{relation.relation === 'conflicts' ? 'VS' : '＋'}</span>
              <i />
            </div>
            <NodeProposition detail={pair[1]} onOpenEvidence={setEvidenceUnitId} position="b" showEvidence={false} />
          </div>
        )}

        {tab === 'evidence' && (
          <div className="relation-evidence-columns">
            {[pair[0], pair[1]].map((detail, index) => (
              <section key={detail.id}>
                <header><span>PROPOSITION / {index === 0 ? 'A' : 'B'}</span><b>{detail.attestations.length} 条证据</b></header>
                <h2>{detail.title}</h2>
                {detail.attestations.map((attestation) => (
                  <NodeEvidenceTrail attestation={attestation} key={`${detail.id}-${attestation.unit_id}`} onOpenEvidence={setEvidenceUnitId} />
                ))}
              </section>
            ))}
          </div>
        )}

        {tab === 'verdict' && (
          <div className="relation-verdict-grid">
            {[pair[0], pair[1]].map((detail, index) => {
              const stats = nodeEvidenceStats(detail)
              const total = stats.hit + stats.partial + stats.miss
              return (
                <section className={index === 0 ? 'verdict-a' : 'verdict-b'} key={detail.id}>
                  <header><span>PROPOSITION / {index === 0 ? 'A' : 'B'}</span><b>{total > 0 ? scoredSummary(detail) : '尚待裁决'}</b></header>
                  <h2>{detail.title}</h2>
                  <div><span><strong>{stats.hit}</strong><small>命中</small></span><span><strong>{stats.partial}</strong><small>部分</small></span><span><strong>{stats.miss}</strong><small>未中</small></span></div>
                  <p>{total > 0 ? `当前结果来自 ${total} 个评分时点。样本量仍需与结论同时阅读。` : '当前没有完成机械评分，不能据此选择一方。'}</p>
                </section>
              )
            })}
          </div>
        )}

        {tab === 'context' && (
          <>
            <section className="relation-full-note"><span>完整关系说明</span><p>{relation.note}</p></section>
            <div className="relation-context-grid">
              {[pair[0], pair[1]].map((detail, index) => (
                <section key={detail.id}>
                  <header><span>PROPOSITION / {index === 0 ? 'A' : 'B'}</span><b>{statusLabels[detail.status]}</b></header>
                  <h2>{detail.title}</h2>
                  <p>{detail.notes ?? '该节点没有额外归并说明。'}</p>
                  <div>{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <a href={`#/knowledge?node=${detail.id}&from=discovery`}>打开完整知识节点 →</a>
                </section>
              ))}
            </div>
          </>
        )}
      </article>

      {evidenceUnitId !== null && (
        <div className="discovery-evidence-overlay">
          <EvidenceDossier
            backLabel="返回关系档案"
            onClose={() => setEvidenceUnitId(null)}
            parentLabel={relation.relation === 'conflicts' ? 'CONFLICT' : 'RELATION'}
            parentTitle={`#${relation.id}`}
            unitId={evidenceUnitId}
          />
        </div>
      )}
    </>
  )
}

export function ConsensusDossier({
  node,
}: {
  node: DiscoveryConsensusNode
}) {
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [evidenceUnitId, setEvidenceUnitId] = useState<number | null>(null)

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
              onOpenEvidence={setEvidenceUnitId}
            />
          ))}
        </section>
        <footer className="consensus-dossier-foot">
          <div>{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <a href={`#/knowledge?node=${detail.id}&from=discovery`}>打开完整节点 →</a>
        </footer>
      </article>

      {evidenceUnitId !== null && (
        <div className="discovery-evidence-overlay">
          <EvidenceDossier
            backLabel="返回共识档案"
            onClose={() => setEvidenceUnitId(null)}
            parentLabel="CONSENSUS"
            parentTitle={`#${detail.id}`}
            unitId={evidenceUnitId}
          />
        </div>
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
