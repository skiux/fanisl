import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import {
  attestationLabels,
  categoryLabels,
  familyLabels,
  kindLabels,
  nodeHeading,
  nodeReach,
  nodeStatusLabels,
  outcomeLabels,
  testabilityLabels,
  verifiabilityLabels,
} from '../../shared/knowledge/labels'
import {
  claimVerdictLine,
  horizonText,
  realizedSummary,
  subjectText,
  symbolText,
  thesisText,
} from '../../shared/knowledge/claim'
import '../../shared/layout/chassis.css'
import { ContentReader, platformLabels, useContentDetail } from './ContentReader'
import EvidenceDossier from './EvidenceDossier'
import type {
  KnowledgeContentSummary,
  KnowledgeCreator,
  KnowledgeNode,
  KnowledgeNodeDetail,
  KnowledgeTagSummary,
  KnowledgeUnitSummary,
} from './types'
import './knowledge.css'

/**
 * 四个入口按知识类型分，不按存储层分。
 * claim 主要活在单元层（135 条，只有 1 条进了节点）；method/concept 全量入节点。
 * 「节点 / 单元」是存储事实，不是用户心智，所以不出现在导航里。
 */
type View = 'claims' | 'methods' | 'concepts' | 'contents'
type LoadState = 'loading' | 'loaded' | 'error'

const viewLabels: Record<View, string> = {
  claims: '判断',
  methods: '方法',
  concepts: '认知',
  contents: '内容',
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function formatFullDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '')
}

/* ------------------------------------------------------------------ 判断行 */

function ClaimRow({ onOpen, unit }: { onOpen: (id: number) => void; unit: KnowledgeUnitSummary }) {
  const payload = unit.payload
  const symbol = symbolText(payload)
  const thesis = thesisText(payload)
  const horizon = horizonText(payload)
  const grade = typeof payload.verifiability === 'string' ? payload.verifiability : null
  const settled = unit.scores.filter((score) => score.outcome !== 'pending')
  const verdict = claimVerdictLine(payload, unit.scores)

  return (
    <button className="claim-row" onClick={() => onOpen(unit.id)} type="button">
      <span className="claim-head">
        {symbol && <em>{symbol}</em>}
        <strong>{subjectText(payload)}</strong>
      </span>
      <span className="claim-thesis">
        {thesis && <b>{thesis}</b>}
        {horizon && <span>{horizon}</span>}
        {grade && <i title={verifiabilityLabels[grade]}>{grade} 级 · {verifiabilityLabels[grade]}</i>}
      </span>
      <span className="claim-quote">{unit.quote}</span>
      <span className="claim-foot">
        <span>{unit.creator}</span>
        <span>{formatFullDate(unit.published_at)}</span>
        {settled.length > 0 ? (
          <span className="claim-verdicts">
            {settled.map((score, index) => (
              <b className={`outcome-${score.outcome}`} key={`${score.horizon_label}-${index}`}>
                {score.horizon_label} {outcomeLabels[score.outcome] ?? score.outcome}
                {realizedSummary(score.realized) ? ` · ${realizedSummary(score.realized)}` : ''}
              </b>
            ))}
          </span>
        ) : (
          <span className={verdict.kind === 'unscorable' ? 'claim-unscorable' : 'claim-pending'}>
            {verdict.text}
          </span>
        )}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ 节点行 */

function NodeRow({ node, onOpen }: { node: KnowledgeNode; onOpen: (id: number) => void }) {
  const head = nodeHeading(node)
  const reach = nodeReach(node)
  const payload = node as unknown as Record<string, unknown>
  void payload

  return (
    <button className="node-row" onClick={() => onOpen(node.id)} type="button">
      <strong>{head.heading}</strong>
      {head.needsBody && <span className="node-canonical">{head.body}</span>}
      <span className="node-foot">
        {node.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
        <span className={reach.cross ? 'reach-cross' : undefined}>
          {reach.label}
          {node.n_attest > 1 ? ` · ${node.n_attest} 次` : ''}
        </span>
        {node.status !== 'active' && node.status !== 'corroborated' && (
          <span>{nodeStatusLabels[node.status]}</span>
        )}
        {node.last_seen && <span>{formatDate(node.last_seen)}</span>}
      </span>
    </button>
  )
}

/* -------------------------------------------------------------- 节点详情页 */

function NodeSheet({
  detail,
  node,
  onOpenUnit,
  onRetry,
  state,
}: {
  detail: KnowledgeNodeDetail | null
  node: KnowledgeNode
  onOpenUnit: (unitId: number) => void
  onRetry: () => void
  state: LoadState
}) {
  const reach = nodeReach(node)
  const head = nodeHeading(node)
  const facts = node.kind === 'method'
    ? [familyLabels[String((detail?.attestations[0]?.payload.family ?? '')) as string], testabilityLabels[String(detail?.attestations[0]?.payload.testability ?? '')]]
    : node.kind === 'concept'
      ? [categoryLabels[String(detail?.attestations[0]?.payload.category ?? '')]]
      : []

  return (
    <article className="node-sheet">
      <header>
        <span>{kindLabels[node.kind]}</span>
        <h1>{head.heading}</h1>
      </header>

      <p className="node-statement">{node.canonical}</p>

      <div className="node-meta">
        <span className={reach.cross ? 'reach-cross' : undefined}>{reach.label}</span>
        <span>{node.n_attest} 次提及 · {node.n_contents} 篇内容 · {node.n_creators} 位信源</span>
        {node.first_seen && (
          <span>
            {formatFullDate(node.first_seen)}
            {node.last_seen && node.last_seen !== node.first_seen ? ` → ${formatFullDate(node.last_seen)}` : ''}
          </span>
        )}
        {facts.filter(Boolean).map((fact) => <span key={fact}>{fact}</span>)}
        {node.tags.map((tag) => <em key={tag}>{tag}</em>)}
      </div>

      {node.notes && (
        <section className="node-note">
          <h2>归并裁量</h2>
          <p>{node.notes}</p>
        </section>
      )}

      {state === 'loading' && <div className="page-skeleton"><i /><i /></div>}

      {state === 'error' && (
        <div className="page-error">
          <strong>完整提及记录没有载入</strong>
          <p>节点摘要仍可阅读；重试不会改变当前筛选与阅读位置。</p>
          <button onClick={onRetry} type="button">重新读取</button>
        </div>
      )}

      {state === 'loaded' && detail && (
        <>
          <section className="node-trail">
            <h2>提及与演进</h2>
            {detail.attestations.length ? (
              <ol>
                {detail.attestations.map((item, index) => (
                  <li key={`${item.unit_id}-${index}`}>
                    <div className="trail-mark">
                      <time>{formatFullDate(item.published_at)}</time>
                      <b className={`relation-${item.relation}`}>{attestationLabels[item.relation]}</b>
                      <span>{item.creator}</span>
                    </div>
                    {item.note && <p className="trail-note">{item.note}</p>}
                    <blockquote>{item.quote}</blockquote>
                    <footer>
                      <span>{item.content_title}</span>
                      <button onClick={() => onOpenUnit(item.unit_id)} type="button">
                        核查逐字证据
                      </button>
                    </footer>
                    {item.scores.length > 0 && (
                      <div className="trail-scores">
                        {item.scores.map((score) => (
                          <b className={`outcome-${score.outcome}`} key={score.id}>
                            {score.horizon_label} {outcomeLabels[score.outcome] ?? score.outcome}
                          </b>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="node-empty-line">该节点没有返回提及记录。</p>
            )}
          </section>

          {detail.relations.length > 0 && (
            <section className="node-edges">
              <h2>关系</h2>
              {detail.relations.map((relation) => (
                <a
                  className={`node-edge edge-${relation.relation}`}
                  href={`#/knowledge?node=${relation.other_id}`}
                  key={`${relation.relation}-${relation.other_id}`}
                >
                  <b>{relation.relation === 'conflicts' ? '对立' : '关联'}</b>
                  <strong>{relation.other_title}</strong>
                  <p>{relation.note}</p>
                </a>
              ))}
            </section>
          )}
        </>
      )}

      {/*
        method / concept 没有评分口径——评分器只作用于 claim。
        对这两类写「等待验证」是假承诺，所以只在 claim 节点上出现市场裁决区。
      */}
      {node.kind === 'claim' && (
        <section className="node-verdicts">
          <h2>市场裁决</h2>
          {node.hit + node.partial + node.miss > 0 ? (
            <p>
              命中 {node.hit} · 部分 {node.partial} · 未中 {node.miss}
              {' · 加权命中率 '}
              {Math.round(((node.hit + node.partial * 0.5) / (node.hit + node.partial + node.miss)) * 100)}%
              （n={node.hit + node.partial + node.miss}）
            </p>
          ) : (
            <p className="node-empty-line">关联时点尚未到期。</p>
          )}
        </section>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------- 页面 */

function KnowledgePage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const detailCache = useRef(new Map<number, KnowledgeNodeDetail>())

  const [view, setView] = useState<View>(() => {
    const params = hashParams()
    if (params.get('node')) return 'concepts'
    if (params.get('search')) return 'claims'
    return 'claims'
  })
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [units, setUnits] = useState<KnowledgeUnitSummary[]>([])
  const [contents, setContents] = useState<KnowledgeContentSummary[]>([])
  const [creators, setCreators] = useState<KnowledgeCreator[]>([])
  const [tags, setTags] = useState<KnowledgeTagSummary[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  const [query, setQuery] = useState('')
  const [creatorId, setCreatorId] = useState<number | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [settledOnly, setSettledOnly] = useState(false)
  const [crossOnly, setCrossOnly] = useState(false)

  const [openNodeId, setOpenNodeId] = useState<number | null>(() => {
    const value = Number(hashParams().get('node'))
    return Number.isInteger(value) && value > 0 ? value : null
  })
  const [openUnitId, setOpenUnitId] = useState<number | null>(null)
  const [openContentId, setOpenContentId] = useState<number | null>(null)

  const [nodeDetail, setNodeDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [nodeDetailState, setNodeDetailState] = useState<LoadState>('loading')
  const [nodeRequestKey, setNodeRequestKey] = useState(0)

  const contentDetail = useContentDetail(openContentId)

  // 发现页与关系边都用 #/knowledge?node=N 深链，hash 的 query 变化不会重挂载组件，
  // 所以要显式同步；同时把打开的节点写回 hash，让链接可分享、浏览器返回键可用。
  useEffect(() => {
    const sync = () => {
      const value = Number(hashParams().get('node'))
      const next = Number.isInteger(value) && value > 0 ? value : null
      setOpenNodeId(next)
      if (next !== null) {
        setOpenUnitId(null)
        setOpenContentId(null)
      }
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const params = hashParams()
    const current = params.get('node')
    const target = openNodeId === null ? null : String(openNodeId)
    if (current === target) return
    if (target === null) params.delete('node')
    else params.set('node', target)
    const query = params.toString()
    const next = `#/knowledge${query ? `?${query}` : ''}`
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [openNodeId])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal }),
      apiJson<KnowledgeUnitSummary[]>('/knowledge/units?limit=500', { signal: controller.signal }),
      apiJson<KnowledgeContentSummary[]>('/knowledge/contents?limit=200', { signal: controller.signal }),
      apiJson<KnowledgeCreator[]>('/knowledge/creators', { signal: controller.signal }),
      apiJson<KnowledgeTagSummary[]>('/knowledge/tags', { signal: controller.signal }),
    ]).then(([nodeRows, unitRows, contentRows, creatorRows, tagRows]) => {
      setNodes(nodeRows)
      setUnits(unitRows)
      setContents(contentRows)
      setCreators(creatorRows)
      setTags(tagRows)
      setLoadState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState('error')
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (openNodeId === null) return
    const cached = detailCache.current.get(openNodeId)
    if (cached) {
      setNodeDetail(cached)
      setNodeDetailState('loaded')
      return
    }
    const controller = new AbortController()
    setNodeDetail(null)
    setNodeDetailState('loading')
    apiJson<KnowledgeNodeDetail>(`/knowledge/nodes/${openNodeId}`, { signal: controller.signal })
      .then((payload) => {
        detailCache.current.set(openNodeId, payload)
        setNodeDetail(payload)
        setNodeDetailState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setNodeDetailState('error')
      })
    return () => controller.abort()
  }, [nodeRequestKey, openNodeId])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpenNodeId(null)
        setOpenUnitId(null)
        setOpenContentId(null)
        searchRef.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      if (openUnitId !== null) { setOpenUnitId(null); return }
      if (openNodeId !== null) { setOpenNodeId(null); return }
      if (openContentId !== null) { setOpenContentId(null); return }
      if (query) setQuery('')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [openContentId, openNodeId, openUnitId, query])

  const text = query.trim().toLocaleLowerCase()

  const claimUnits = useMemo(() => units.filter((unit) => unit.kind === 'claim'), [units])
  const methodNodes = useMemo(() => nodes.filter((node) => node.kind === 'method'), [nodes])
  const conceptNodes = useMemo(() => nodes.filter((node) => node.kind === 'concept'), [nodes])
  const claimNodes = useMemo(() => nodes.filter((node) => node.kind === 'claim'), [nodes])

  const visibleClaims = useMemo(() => claimUnits.filter((unit) => {
    if (creatorId !== null && unit.creator_id !== creatorId) return false
    if (tag && !unit.tags.includes(tag)) return false
    if (settledOnly && !unit.scores.some((score) => score.outcome !== 'pending')) return false
    if (!text) return true
    return `${unit.quote} ${JSON.stringify(unit.payload)} ${unit.tags.join(' ')}`
      .toLocaleLowerCase().includes(text)
  }), [claimUnits, creatorId, settledOnly, tag, text])

  const filterNodes = (rows: KnowledgeNode[]) => rows.filter((node) => {
    if (crossOnly && node.n_creators < 2) return false
    if (tag && !node.tags.includes(tag)) return false
    if (!text) return true
    return `${node.title} ${node.canonical} ${node.notes ?? ''} ${node.tags.join(' ')}`
      .toLocaleLowerCase().includes(text)
  })

  const visibleMethods = useMemo(() => filterNodes(methodNodes), [crossOnly, methodNodes, tag, text])
  const visibleConcepts = useMemo(() => filterNodes(conceptNodes), [conceptNodes, crossOnly, tag, text])

  const visibleContents = useMemo(() => contents.filter((content) => {
    if (creatorId !== null && content.creator_id !== creatorId) return false
    if (!text) return true
    return `${content.title} ${content.creator}`.toLocaleLowerCase().includes(text)
  }), [contents, creatorId, text])

  const counts = {
    claims: claimUnits.length,
    methods: methodNodes.length,
    concepts: conceptNodes.length,
    contents: contents.length,
  }

  const openNode = nodes.find((node) => node.id === openNodeId) ?? null

  useEffect(() => {
    if (!openNode) return
    const target: View = openNode.kind === 'method' ? 'methods' : openNode.kind === 'concept' ? 'concepts' : 'claims'
    setView((current) => (current === target ? current : target))
  }, [openNode])
  const openContent = contents.find((content) => content.id === openContentId) ?? null
  const inDetail = openUnitId !== null || openNode !== null || openContent !== null

  const resetFilters = () => {
    setQuery('')
    setCreatorId(null)
    setTag(null)
    setSettledOnly(false)
    setCrossOnly(false)
  }

  const hasFilters = Boolean(query.trim()) || creatorId !== null || tag !== null || settledOnly || crossOnly

  const selectView = (next: View) => {
    setOpenNodeId(null)
    setView(next)
    setOpenUnitId(null)
    setOpenContentId(null)
  }

  const closeDetail = () => {
    if (openUnitId !== null) { setOpenUnitId(null); return }
    setOpenNodeId(null)
    setOpenContentId(null)
  }

  const tagList = useMemo(() => {
    if (view === 'claims') {
      return tags.filter((item) => item.n_claims > 0).slice(0, 10)
        .map((item) => [item.tag, item.n_claims] as const)
    }
    const source = view === 'methods' ? methodNodes : conceptNodes
    const counter = new Map<string, number>()
    source.forEach((node) => node.tags.forEach((item) => counter.set(item, (counter.get(item) ?? 0) + 1)))
    return [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  }, [conceptNodes, methodNodes, tags, view])

  return (
    <div className="page-shell knowledge-page">
      <div aria-hidden="true" className="knowledge-material" />
      <AppHeader current="knowledge" onSearch={() => searchRef.current?.focus()} />

      <main className="page-stage">
        <header className="page-masthead">
          <h1>知识库</h1>
          <div className="page-facts">
            <span><b>{units.length}</b> 条单元</span><i />
            <span><b>{nodes.length}</b> 个节点</span><i />
            <span><b>{contents.length}</b> 篇内容</span><i />
            <span><b>{creators.length}</b> 位信源</span>
          </div>
        </header>

        <nav aria-label="知识类型" className="page-tabs">
          {(Object.keys(viewLabels) as View[]).map((item) => (
            <button
              aria-pressed={view === item}
              key={item}
              onClick={() => selectView(item)}
              type="button"
            >
              {viewLabels[item]}<b>{counts[item]}</b>
            </button>
          ))}
        </nav>

        <div className="page-body">
          <aside className="page-rail">
            {inDetail ? (
              <>
                <button className="rail-back" onClick={closeDetail} type="button">
                  ← 返回{viewLabels[view]}
                </button>
                {openUnitId !== null && openNode && (
                  <p className="rail-note">正在核查该节点某一次提及的逐字证据。</p>
                )}
              </>
            ) : (
              <>
                {(view === 'claims' || view === 'contents') && creators.length > 0 && (
                  <div className="rail-block">
                    <p>信源</p>
                    <button aria-pressed={creatorId === null} onClick={() => setCreatorId(null)} type="button">
                      <span>全部</span>
                    </button>
                    {creators.map((creator) => (
                      <button
                        aria-pressed={creatorId === creator.id}
                        key={creator.id}
                        onClick={() => setCreatorId(creator.id)}
                        type="button"
                      >
                        <span>{creator.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {view !== 'contents' && tagList.length > 0 && (
                  <div className="rail-block">
                    <p>主题</p>
                    {tagList.map(([name, n]) => (
                      <button
                        aria-pressed={tag === name}
                        key={name}
                        onClick={() => setTag(tag === name ? null : name)}
                        type="button"
                      >
                        <span>{name}</span><b>{n}</b>
                      </button>
                    ))}
                  </div>
                )}

                {view === 'claims' && (
                  <label className="rail-toggle">
                    <input
                      checked={settledOnly}
                      onChange={(event) => setSettledOnly(event.target.checked)}
                      type="checkbox"
                    />
                    只看已判定
                  </label>
                )}

                {(view === 'methods' || view === 'concepts') && (
                  <label className="rail-toggle">
                    <input
                      checked={crossOnly}
                      onChange={(event) => setCrossOnly(event.target.checked)}
                      type="checkbox"
                    />
                    只看跨信源
                  </label>
                )}

                {view === 'methods' && (
                  <p className="rail-note">
                    方法与认知没有评分口径，评分器只作用于判断。
                  </p>
                )}
              </>
            )}
          </aside>

          <div className="page-main">
            {!inDetail && (
              <>
                <div className="main-toolbar">
                  <label>
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label={`检索${viewLabels[view]}`}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={view === 'claims' ? '检索标的、引文或结构字段' : view === 'contents' ? '检索标题或信源' : '检索命题与归并注记'}
                      ref={searchRef}
                      value={query}
                    />
                  </label>
                </div>

                <div className="main-count">
                  <span>
                    <strong>
                      {view === 'claims' ? visibleClaims.length
                        : view === 'methods' ? visibleMethods.length
                        : view === 'concepts' ? visibleConcepts.length
                        : visibleContents.length}
                    </strong>
                    {' '}
                    {view === 'contents' ? '篇' : '条'}
                    {hasFilters ? '（已筛选）' : ''}
                  </span>
                  {hasFilters && <button onClick={resetFilters} type="button">清除条件</button>}
                </div>
              </>
            )}

            {loadState === 'loading' && <div className="page-skeleton"><i /><i /><i /></div>}

            {loadState === 'error' && (
              <div className="page-error">
                <strong>知识库没有载入</strong>
                <p>后端未连接。页面不会用样板数据代替真实知识。</p>
              </div>
            )}

            {loadState === 'loaded' && openUnitId !== null && (
              <EvidenceDossier
                embedded
                onClose={() => setOpenUnitId(null)}
                parentLabel="证据"
                parentTitle=""
                unitId={openUnitId}
              />
            )}

            {loadState === 'loaded' && openUnitId === null && openNode && (
              <NodeSheet
                detail={nodeDetail}
                node={openNode}
                onOpenUnit={setOpenUnitId}
                onRetry={() => setNodeRequestKey((value) => value + 1)}
                state={nodeDetailState}
              />
            )}

            {loadState === 'loaded' && openUnitId === null && openContent && (
              <ContentReader
                content={openContent}
                onOpenUnit={setOpenUnitId}
                onRetry={contentDetail.retry}
                payload={contentDetail.payload}
                state={contentDetail.state}
              />
            )}

            {loadState === 'loaded' && !inDetail && view === 'claims' && claimNodes.length > 0 && !hasFilters && (
              <section className="claim-merged">
                <h2>被重申的判断</h2>
                <p>同一目标价被多次公开重申，已归并为节点。</p>
                {claimNodes.map((node) => (
                  <button key={node.id} onClick={() => setOpenNodeId(node.id)} type="button">
                    <strong>{nodeHeading(node).heading}</strong>
                    <span>{node.n_attest} 次重申 · {node.n_creators} 位信源</span>
                  </button>
                ))}
              </section>
            )}

            {loadState === 'loaded' && !inDetail && view === 'claims' && (
              visibleClaims.length ? (
                <div className="claim-list">
                  {visibleClaims.map((unit, index) => {
                    const month = String(unit.published_at).slice(0, 7)
                    const previous = index > 0 ? String(visibleClaims[index - 1].published_at).slice(0, 7) : null
                    return (
                      <div key={unit.id}>
                        {month !== previous && <p className="list-month">{month.replace('-', ' 年 ')} 月</p>}
                        <ClaimRow onOpen={setOpenUnitId} unit={unit} />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="page-empty">
                  <strong>没有匹配的判断</strong>
                  <p>条件同时作用于标的、引文与结构字段。</p>
                  <button onClick={resetFilters} type="button">清除条件</button>
                </div>
              )
            )}

            {loadState === 'loaded' && !inDetail && (view === 'methods' || view === 'concepts') && (
              (view === 'methods' ? visibleMethods : visibleConcepts).length ? (
                <div className="node-list">
                  {(view === 'methods' ? visibleMethods : visibleConcepts).map((node) => (
                    <NodeRow key={node.id} node={node} onOpen={setOpenNodeId} />
                  ))}
                </div>
              ) : (
                <div className="page-empty">
                  <strong>没有匹配的{viewLabels[view]}</strong>
                  <p>
                    {crossOnly
                      ? '全库只有 1 个节点被两位以上信源表达；跨源重合需要更多信源。'
                      : '调整检索词或清除主题条件。'}
                  </p>
                  <button onClick={resetFilters} type="button">清除条件</button>
                </div>
              )
            )}

            {loadState === 'loaded' && !inDetail && view === 'contents' && (
              <div className="content-list">
                {visibleContents.map((content) => (
                  <button
                    className="content-row"
                    key={content.id}
                    onClick={() => setOpenContentId(content.id)}
                    type="button"
                  >
                    <span className="content-date">{formatFullDate(content.published_at)}</span>
                    <strong>{content.title}</strong>
                    <span className="content-foot">
                      <span>{content.creator}</span>
                      <span>{platformLabels[content.platform] ?? content.platform}</span>
                      <span>{content.n_claims} 判断 · {content.n_methods} 方法 · {content.n_concepts} 认知</span>
                    </span>
                  </button>
                ))}
                {visibleContents.length === 0 && (
                  <div className="page-empty">
                    <strong>没有匹配的内容</strong>
                    <button onClick={resetFilters} type="button">清除条件</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default KnowledgePage
