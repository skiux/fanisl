import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import { previewNodes, previewStats } from './preview'
import type { KnowledgeKind, KnowledgeNode, KnowledgeStats, NodeStatus } from './types'
import './knowledge.css'

const kindLabels: Record<KnowledgeKind, string> = {
  claim: '判断',
  method: '方法',
  concept: '认知',
}

const statusLabels: Record<NodeStatus, string> = {
  active: '活跃',
  corroborated: '多次佐证',
  verified: '已验证',
  contested: '存在争议',
  retired: '已退役',
}

type KindFilter = 'all' | KnowledgeKind
type StatusFilter = 'all' | NodeStatus
type SortMode = 'evidence' | 'recent'
type LoadMode = 'loading' | 'live' | 'preview'

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

function KnowledgePage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [stats, setStats] = useState<KnowledgeStats>(previewStats)
  const [loadMode, setLoadMode] = useState<LoadMode>('loading')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [crossSource, setCrossSource] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('evidence')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [nodeRows, creators, contents, units] = await Promise.all([
          apiJson<KnowledgeNode[]>('/knowledge/nodes?limit=300', { signal: controller.signal }),
          apiJson<unknown[]>('/knowledge/creators', { signal: controller.signal }),
          apiJson<unknown[]>('/knowledge/contents?limit=200', { signal: controller.signal }),
          apiJson<unknown[]>('/knowledge/units?limit=500', { signal: controller.signal }),
        ])
        setNodes(nodeRows)
        setStats({
          nodes: nodeRows.length,
          contents: contents.length,
          units: units.length,
          creators: creators.length,
          corroborated: nodeRows.filter((node) => node.status === 'corroborated').length,
        })
        setSelectedId([...nodeRows].sort(compareEvidence)[0]?.id ?? null)
        setLoadMode('live')
      } catch {
        if (controller.signal.aborted) return
        setNodes(previewNodes)
        setStats(previewStats)
        setSelectedId([...previewNodes].sort(compareEvidence)[0]?.id ?? null)
        setLoadMode('preview')
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

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
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
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

  const resetFilters = () => {
    setKind('all')
    setStatus('all')
    setTag(null)
    setCrossSource(false)
    setQuery('')
  }

  return (
    <div className="knowledge-page">
      <div aria-hidden="true" className="knowledge-material" />
      <AppHeader
        current="knowledge"
        onSearch={() => searchRef.current?.focus()}
      />

      <main>
        <section className="knowledge-intro">
          <p className="knowledge-eyebrow"><span>01</span><i /> KNOWLEDGE LIBRARY · NODE INDEX</p>
          <div className="knowledge-intro-grid">
            <h1>长期知识，<br /><em>按证据生长。</em></h1>
            <div className="knowledge-intro-copy">
              <p>这里不按视频堆放信息。相同的表达被归并，修正留在时间线上，分歧则保留为关系。</p>
              <div className="knowledge-ledger" aria-label="知识库规模">
                <span><strong>{stats.nodes}</strong><small>长期节点</small></span>
                <span><strong>{stats.corroborated}</strong><small>多次佐证</small></span>
                <span><strong>{stats.units}</strong><small>证据单元</small></span>
                <span><strong>{stats.contents}</strong><small>原始内容</small></span>
              </div>
            </div>
          </div>
        </section>

        <section className="knowledge-workspace">
          <aside className="knowledge-filters" aria-label="节点筛选">
            <div className="filter-heading">
              <span>INDEX / 01</span>
              <strong>节点视图</strong>
            </div>

            <div className="filter-section">
              <p>知识类型</p>
              {([
                ['all', '全部节点'],
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
            </div>

            <div className="filter-section">
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
            </div>

            <div className="filter-section filter-tags">
              <p>常用主题</p>
              <div>
                {popularTags.map(([value, count]) => (
                  <button
                    aria-pressed={tag === value}
                    key={value}
                    onClick={() => setTag(tag === value ? null : value)}
                    type="button"
                  >
                    {value}<sup>{count}</sup>
                  </button>
                ))}
              </div>
            </div>

            <label className="cross-source-toggle">
              <input
                checked={crossSource}
                onChange={(event) => setCrossSource(event.target.checked)}
                type="checkbox"
              />
              <span><i /></span>
              <b>只看跨信源</b>
            </label>
          </aside>

          <div className="knowledge-index">
            <div className="node-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索长期知识节点"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索命题、方法、主题或归并注记"
                ref={searchRef}
                value={query}
              />
              {query && <button aria-label="清空搜索" onClick={() => setQuery('')} type="button">×</button>}
              <kbd>⌘K</kbd>
            </div>

            <div className="index-toolbar">
              <p><strong>{visibleNodes.length}</strong> 个节点进入当前视图</p>
              <div aria-label="节点排序">
                <button aria-pressed={sortMode === 'evidence'} onClick={() => setSortMode('evidence')} type="button">提及优先</button>
                <button aria-pressed={sortMode === 'recent'} onClick={() => setSortMode('recent')} type="button">最近演进</button>
              </div>
            </div>

            {loadMode === 'preview' && (
              <div className="preview-notice">
                <i />
                <span>当前后端未连接，使用仓库中的真实归并样本预览版式。</span>
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
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
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
                        <span>{scoreCount ? `${scoreCount} 个评分时点` : '等待验证证据'}</span>
                      </span>
                    </span>
                    <span className="node-row-arrow">↗</span>
                  </button>
                )
              })}

              {loadMode !== 'loading' && visibleNodes.length === 0 && (
                <div className="knowledge-empty">
                  <span>NO MATCHED NODE</span>
                  <strong>当前条件下没有长期节点。</strong>
                  <p>这通常意味着筛选条件过窄，而不是知识库没有内容。</p>
                  <button onClick={resetFilters} type="button">清除全部条件</button>
                </div>
              )}
            </div>
          </div>

          <aside className="node-reader" aria-live="polite">
            {selectedNode && <NodeReader node={selectedNode} />}
          </aside>
        </section>
      </main>

      <footer className="knowledge-footer">
        <span>FANISL / KNOWLEDGE WITH PROVENANCE</span>
        <p>{stats.creators} 位信源 · 每个节点都能返回原始证据</p>
      </footer>
    </div>
  )
}

function NodeReader({ node }: { node: KnowledgeNode }) {
  const scoreCount = node.hit + node.partial + node.miss
  const weightedHitRate = scoreCount
    ? Math.round(((node.hit + node.partial * 0.5) / scoreCount) * 100)
    : null
  const firstSeen = formatDate(node.first_seen)
  const lastSeen = formatDate(node.last_seen)

  return (
    <article className={`node-reader-card kind-${node.kind}`} key={node.id}>
      <header>
        <span>NODE / {String(node.id).padStart(3, '0')}</span>
        <b>{statusLabels[node.status]}</b>
      </header>
      <div className="reader-kind"><i />{kindLabels[node.kind]}</div>
      <h2>{node.title}</h2>
      <p className="reader-canonical">{node.canonical}</p>

      <div className="reader-tags">
        {node.tags.map((item) => <span key={item}>{item}</span>)}
      </div>

      <section className="evidence-route">
        <p>EVIDENCE ROUTE</p>
        <div>
          <span><small>提及</small><strong>{node.n_attest}</strong></span>
          <i />
          <span><small>原始内容</small><strong>{node.n_contents}</strong></span>
          <i />
          <span><small>信源</small><strong>{node.n_creators}</strong></span>
        </div>
        {(firstSeen || lastSeen) && (
          <small>{firstSeen ?? '—'} <i /> {lastSeen ?? firstSeen}</small>
        )}
      </section>

      <section className="reader-note">
        <p>归并与演进注记</p>
        <blockquote>{node.notes || '该节点由单次提及建立，尚未形成归并注记。'}</blockquote>
      </section>

      <section className="reader-score">
        <div>
          <p>市场裁决</p>
          <span>{scoreCount ? `${weightedHitRate}% · n=${scoreCount}` : '尚无可计分时点'}</span>
        </div>
        {scoreCount ? (
          <div className="score-segments" aria-label={`命中 ${node.hit}，部分 ${node.partial}，未中 ${node.miss}`}>
            <i style={{ flex: node.hit || 0.001 }} />
            <i style={{ flex: node.partial || 0.001 }} />
            <i style={{ flex: node.miss || 0.001 }} />
          </div>
        ) : (
          <div className="score-pending"><i />没有 0%，只有尚未到期或不可评分。</div>
        )}
      </section>

      <footer>
        <span>节点会随新提及继续演进</span>
        <b>PROVENANCE INTACT</b>
      </footer>
    </article>
  )
}

export default KnowledgePage
