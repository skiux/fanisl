import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  active: '持续演进',
  corroborated: '多源佐证',
  verified: '已经验证',
  contested: '存在分歧',
  retired: '停止维护',
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
  const [readerOpen, setReaderOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

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
      if (event.key !== 'Escape') return
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
      }
      setReaderOpen(false)
      setFiltersOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

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

  const selectNode = (node: KnowledgeNode, openOnMobile = false) => {
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
      <AppHeader current="knowledge" onSearch={() => searchRef.current?.focus()} />

      <main className="knowledge-stage">
        <header className="library-masthead">
          <div className="masthead-title">
            <span>01 / KNOWLEDGE LIBRARY</span>
            <h1>知识库</h1>
          </div>
          <p className="masthead-statement">
            不是内容的仓库，而是从原始表达中持续归并、修正并保留来源的长期认知。
          </p>
          <div className="masthead-ledger" aria-label="知识库规模">
            <span><strong>{stats.nodes}</strong><small>长期节点</small></span>
            <span><strong>{stats.corroborated}</strong><small>多源佐证</small></span>
            <span><strong>{stats.units}</strong><small>证据单元</small></span>
            <span><strong>{stats.contents}</strong><small>原始内容</small></span>
          </div>
        </header>

        <section className="library-frame">
          <button
            aria-label="关闭筛选"
            className="frame-backdrop"
            data-open={filtersOpen || readerOpen}
            onClick={() => {
              setFiltersOpen(false)
              setReaderOpen(false)
            }}
            type="button"
          />

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
            <button className="reader-close" onClick={() => setReaderOpen(false)} type="button">
              <span>返回节点索引</span><b>×</b>
            </button>
            {selectedNode && (
              <NodeReader
                node={selectedNode}
                position={selectedPosition}
                total={visibleNodes.length}
              />
            )}
          </aside>
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
  node,
  position,
  total,
}: {
  node: KnowledgeNode
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
