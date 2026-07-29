import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { apiJson } from '../../shared/api/client'
import AppHeader from '../../shared/navigation/AppHeader'
import MarkdownDocument from './MarkdownDocument'
import {
  documentStats,
  extractDocumentExcerpt,
  extractMarkdownHeadings,
} from './markdownModel'
import type {
  ArchiveCategory,
  ResearchDocName,
  ResearchDocSummary,
  ResearchDocument,
} from './types'
import './archive.css'

type LoadState = 'loading' | 'loaded' | 'error'

type DocumentMeta = {
  category: Exclude<ArchiveCategory, 'all'>
  code: string
  label: string
  note: string
}

const documentNames: ResearchDocName[] = [
  'capstone',
  'research-log',
  'eval-repositioning',
  'knowledge-engine',
]

const documentMeta: Record<ResearchDocName, DocumentMeta> = {
  capstone: {
    category: 'closure',
    code: 'A-01',
    label: '量化研究收官',
    note: '正式句号 · 23 个裁决与再启动边界',
  },
  'research-log': {
    category: 'closure',
    code: 'A-02',
    label: '逐假设裁决日志',
    note: '追加式记录 · 数字、边界与尸检',
  },
  'eval-repositioning': {
    category: 'method',
    code: 'M-01',
    label: '评测台重定位',
    note: '从酌情判断转向 setup 级 edge',
  },
  'knowledge-engine': {
    category: 'method',
    code: 'M-02',
    label: '知识引擎设计',
    note: '定位、分层与 K0–K6 建设记录',
  },
}

const categoryLabels: Record<ArchiveCategory, string> = {
  all: '全部档案',
  closure: '研究收官',
  method: '制度遗产',
}

function isDocumentName(value: string): value is ResearchDocName {
  return documentNames.includes(value as ResearchDocName)
}

function initialDocumentName() {
  const query = window.location.hash.split('?')[1] ?? ''
  const requested = new URLSearchParams(query).get('doc')
  return requested && isDocumentName(requested) ? requested : 'capstone'
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function ArchivePage() {
  const searchRef = useRef<HTMLInputElement>(null)
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [summaries, setSummaries] = useState<ResearchDocSummary[]>([])
  const [documents, setDocuments] = useState<ResearchDocument[]>([])
  const [failedNames, setFailedNames] = useState<ResearchDocName[]>([])
  const [category, setCategory] = useState<ArchiveCategory>('all')
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<ResearchDocName>(initialDocumentName)
  const [railOpen, setRailOpen] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    setFailedNames([])
    apiJson<ResearchDocSummary[]>('/research/docs', { signal: controller.signal })
      .then(async (payload) => {
        const index = payload.filter((item): item is ResearchDocSummary => isDocumentName(item.name))
        setSummaries(index)
        const results = await Promise.allSettled(
          index.map((item) => apiJson<ResearchDocument>(
            `/research/docs/${item.name}`,
            { signal: controller.signal },
          )),
        )
        if (controller.signal.aborted) return
        const loaded: ResearchDocument[] = []
        const failed: ResearchDocName[] = []
        results.forEach((result, indexPosition) => {
          const name = index[indexPosition].name
          if (result.status === 'fulfilled') loaded.push(result.value)
          else failed.push(name)
        })
        setDocuments(loaded)
        setFailedNames(failed)
        setLoadState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState('error')
      })
    return () => controller.abort()
  }, [requestKey])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        window.location.hash = '#/knowledge?search=1'
        return
      }
      if (
        event.key === '/'
        && document.activeElement !== searchRef.current
        && !(document.activeElement instanceof HTMLInputElement)
      ) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      if (document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
        return
      }
      setRailOpen(false)
      setReaderOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    if (!window.matchMedia('(max-width: 900px)').matches || (!railOpen && !readerOpen)) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [railOpen, readerOpen])

  const documentByName = useMemo(
    () => new Map(documents.map((document) => [document.name, document])),
    [documents],
  )
  const summaryByName = useMemo(
    () => new Map(summaries.map((summary) => [summary.name, summary])),
    [summaries],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSummaries = useMemo(() => summaries.filter((summary) => {
    const meta = documentMeta[summary.name]
    if (category !== 'all' && meta.category !== category) return false
    if (!normalizedQuery) return true
    const document = documentByName.get(summary.name)
    return `${summary.title} ${meta.label} ${meta.note} ${document?.content ?? ''}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  }), [category, documentByName, normalizedQuery, summaries])

  const selectedDocument = documentByName.get(selectedName) ?? null
  const selectedSummary = summaryByName.get(selectedName) ?? null
  const selectedMeta = documentMeta[selectedName]
  const selectedStats = selectedDocument ? documentStats(selectedDocument.content) : null
  const headings = useMemo(
    () => selectedDocument ? extractMarkdownHeadings(selectedDocument.content) : [],
    [selectedDocument],
  )
  const sectionHeadings = useMemo(
    () => headings.filter((heading) => heading.level > 1 && heading.level <= 3),
    [headings],
  )
  const capstoneStats = documentByName.get('capstone')
    ? documentStats(documentByName.get('capstone')!.content)
    : null
  const sourceLines = documents.reduce(
    (total, document) => total + document.content.trimEnd().split(/\r?\n/).length,
    0,
  )

  useEffect(() => {
    const scrollNode = readerScrollRef.current
    if (!scrollNode) return
    scrollNode.scrollTo({ top: 0 })
    setProgress(0)
    setActiveHeadingId(headings[0]?.id ?? null)
  }, [headings, selectedName])

  const selectDocument = (name: ResearchDocName, openOnNarrow = true) => {
    setSelectedName(name)
    setRailOpen(false)
    const next = `#/archive?doc=${name}`
    if (window.location.hash !== next) window.history.replaceState(null, '', next)
    if (openOnNarrow && window.matchMedia('(max-width: 900px)').matches) {
      setReaderOpen(true)
    }
  }

  const selectCategory = (next: ArchiveCategory) => {
    setCategory(next)
    if (next !== 'all' && documentMeta[selectedName].category !== next) {
      const first = summaries.find((summary) => documentMeta[summary.name].category === next)
      if (first) selectDocument(first.name, false)
    }
    setRailOpen(false)
  }

  const handleReaderScroll = () => {
    const node = readerScrollRef.current
    if (!node) return
    const available = node.scrollHeight - node.clientHeight
    setProgress(available > 0 ? Math.min(1, node.scrollTop / available) : 1)
    const headingNodes = Array.from(
      node.querySelectorAll<HTMLElement>('.archive-markdown [id]'),
    )
    let current = headingNodes[0]?.id ?? null
    for (const heading of headingNodes) {
      if (heading.offsetTop <= node.scrollTop + 150) current = heading.id
      else break
    }
    setActiveHeadingId(current)
  }

  const jumpToHeading = (id: string) => {
    const node = readerScrollRef.current
    const heading = node?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!node || !heading) return
    node.scrollTo({ top: heading.offsetTop - 34, behavior: 'smooth' })
  }

  const handleRowKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleSummaries.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleSummaries.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const next = visibleSummaries[nextIndex]
    selectDocument(next.name, false)
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-archive-key="${next.name}"]`)?.focus()
    })
  }

  const categoryCount = (filter: ArchiveCategory) => filter === 'all'
    ? summaries.length
    : summaries.filter((summary) => documentMeta[summary.name].category === filter).length

  return (
    <div className="archive-page">
      <div aria-hidden="true" className="archive-material" />
      <AppHeader
        current="archive"
        onSearch={() => {
          window.location.hash = '#/knowledge?search=1'
        }}
      />

      <main className="archive-stage">
        <header className="archive-masthead">
          <div className="archive-title">
            <span>06 / RESEARCH ARCHIVE</span>
            <h1>档案</h1>
            <p><i />只读 · 研究收官陈列</p>
          </div>
          <div className="archive-statement">
            <strong>让负结果留下尊严，<br />也留下不能再越过的边界。</strong>
            <p>这里保存已经被证伪的路径、方法纪律与产品转向；它们不是失败记录，而是下一次研究的先验。</p>
          </div>
          <div aria-label="研究档案规模" className="archive-ledger">
            <span>
              <strong>{loadState === 'loaded' ? summaries.length : '—'}</strong>
              <small>白名单文档</small>
            </span>
            <span>
              <strong>{capstoneStats?.verdicts ?? '—'}</strong>
              <small>预注册裁决</small>
            </span>
            <span>
              <strong>{sourceLines ? formatCount(sourceLines) : '—'}</strong>
              <small>源文档行</small>
            </span>
          </div>
        </header>

        <section className="archive-workbench">
          <button
            aria-label="关闭当前面板"
            className="archive-backdrop"
            data-open={railOpen}
            onClick={() => setRailOpen(false)}
            type="button"
          />

          <aside className="archive-rail" data-open={railOpen}>
            <header>
              <span>ARCHIVE / REGISTER</span>
              <button onClick={() => setRailOpen(false)} type="button">完成</button>
            </header>
            <nav aria-label="档案分类">
              {(Object.keys(categoryLabels) as ArchiveCategory[]).map((item) => (
                <button
                  aria-pressed={category === item}
                  key={item}
                  onClick={() => selectCategory(item)}
                  type="button"
                >
                  <span>{categoryLabels[item]}</span>
                  <b>{loadState === 'loaded'
                    ? String(categoryCount(item)).padStart(2, '0')
                    : '—'}</b>
                </button>
              ))}
            </nav>
            <section className="archive-principle">
              <span>ARCHIVAL RULE</span>
              <strong>负结果是一等资产</strong>
              <p>预注册判据不可事后移动；KILLED 照实保存，线索只能以新编号重新接受样本外裁决。</p>
            </section>
            <section className="archive-sequence">
              <span>RESEARCH SEQUENCE</span>
              <ol>
                <li><i /><span>预注册<small>锁死判据</small></span></li>
                <li><i /><span>时点审计<small>阻断未来函数</small></span></li>
                <li><i /><span>样本外裁决<small>保留完整边界</small></span></li>
                <li><i /><span>收官陈列<small>转化为先验</small></span></li>
              </ol>
            </section>
            <footer><span><i />READ ONLY</span><b>FANISL / 06</b></footer>
          </aside>

          <section className="archive-index">
            <header className="archive-panel-head">
              <button
                className="archive-filter-trigger"
                onClick={() => setRailOpen(true)}
                type="button"
              >
                <i />{categoryLabels[category]}
              </button>
              <div>
                <strong>研究档案索引</strong>
                <span>白名单源文件 · 原文保真渲染</span>
              </div>
              <p>
                <b>{loadState === 'loaded' ? visibleSummaries.length : '—'}</b>
                <span>/ {loadState === 'loaded' ? summaries.length : '—'}</span>
              </p>
            </header>

            <label className="archive-query">
              <span>⌕</span>
              <input
                aria-label="检索档案"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="检索标题、裁决或研究方法"
                ref={searchRef}
                type="search"
                value={query}
              />
              <kbd>/</kbd>
            </label>

            <div className="archive-document-list">
              {loadState === 'loading' && (
                <div aria-label="正在读取研究档案" className="archive-index-loading">
                  <span /><span /><span /><span />
                </div>
              )}

              {loadState === 'error' && (
                <div className="archive-index-state">
                  <span>ARCHIVE INDEX UNAVAILABLE</span>
                  <strong>档案索引暂时没有载入</strong>
                  <p>页面没有用本地假数据替代接口内容。</p>
                  <button onClick={() => setRequestKey((value) => value + 1)} type="button">
                    重新读取索引
                  </button>
                </div>
              )}

              {loadState === 'loaded' && visibleSummaries.length === 0 && (
                <div className="archive-index-state">
                  <span>NO MATCH IN ARCHIVE</span>
                  <strong>没有与当前条件相符的档案</strong>
                  <p>检索只作用于四份白名单原文，不扩展到未陈列的内部文档。</p>
                  <button
                    onClick={() => {
                      setQuery('')
                      setCategory('all')
                    }}
                    type="button"
                  >
                    清除检索条件
                  </button>
                </div>
              )}

              {loadState === 'loaded' && visibleSummaries.map((summary, index) => {
                const meta = documentMeta[summary.name]
                const document = documentByName.get(summary.name)
                const stats = document ? documentStats(document.content) : null
                const failed = failedNames.includes(summary.name)
                return (
                  <button
                    aria-pressed={selectedName === summary.name}
                    className={failed ? 'is-unavailable' : ''}
                    data-archive-key={summary.name}
                    key={summary.name}
                    onClick={() => selectDocument(summary.name)}
                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                    type="button"
                  >
                    <span className="archive-document-code">{meta.code}</span>
                    <div>
                      <small>{meta.category === 'closure' ? 'RESEARCH CLOSURE' : 'METHOD LEGACY'}</small>
                      <strong>{meta.label}</strong>
                      <p>{document ? extractDocumentExcerpt(document.content) : meta.note}</p>
                      <footer>
                        <span>{failed ? '原文读取失败' : `${stats?.minutes ?? '—'} 分钟`}</span>
                        <span>{stats ? `${stats.headings} 章节` : '等待原文'}</span>
                        <b>{failed ? 'RETRY' : 'READ →'}</b>
                      </footer>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="archive-reader" data-open={readerOpen}>
            <div
              aria-hidden="true"
              className="archive-progress"
              style={{ '--archive-progress': progress } as CSSProperties}
            />
            <button
              className="archive-reader-close"
              onClick={() => setReaderOpen(false)}
              type="button"
            >
              <span>返回档案索引</span><b>×</b>
            </button>

            {selectedDocument && selectedSummary && selectedStats ? (
              <div
                className="archive-reader-scroll"
                onScroll={handleReaderScroll}
                ref={readerScrollRef}
              >
                <div className="archive-reader-grid">
                  <article className="archive-document">
                    <header className="archive-document-jacket">
                      <div className="archive-jacket-topline">
                        <span>{selectedMeta.code} / {selectedMeta.category === 'closure' ? 'CLOSURE' : 'METHOD'}</span>
                        <b><i />READ ONLY</b>
                      </div>
                      <p>{selectedDocument.path}</p>
                      <h2>{selectedMeta.label}</h2>
                      <strong>{selectedSummary.title}</strong>
                      <div className="archive-document-facts">
                        <span><b>{formatCount(selectedStats.characters)}</b><small>非空白字符</small></span>
                        <span><b>{selectedStats.headings}</b><small>原文章节</small></span>
                        <span><b>{selectedStats.minutes}</b><small>预计分钟</small></span>
                        {selectedStats.verdicts > 0 && (
                          <span><b>{selectedStats.verdicts}</b><small>编号提及</small></span>
                        )}
                      </div>
                    </header>

                    {sectionHeadings.length > 0 && (
                      <details className="archive-mobile-toc">
                        <summary>本文目录 <span>{sectionHeadings.length} 节</span></summary>
                        <nav aria-label="移动端文档目录">
                          {sectionHeadings.map((heading) => (
                            <button
                              className={`level-${heading.level}`}
                              key={heading.id}
                              onClick={() => jumpToHeading(heading.id)}
                              type="button"
                            >
                              {heading.text}
                            </button>
                          ))}
                        </nav>
                      </details>
                    )}

                    <MarkdownDocument
                      content={selectedDocument.content}
                      onDocumentSelect={(name) => selectDocument(name, false)}
                    />

                    <footer className="archive-document-end">
                      <span>END OF SOURCE DOCUMENT</span>
                      <i />
                      <p>原文由后端白名单读取；页面不改写裁决，也不提供编辑入口。</p>
                    </footer>
                  </article>

                  <aside className="archive-toc">
                    <header>
                      <span>DOCUMENT / CONTENTS</span>
                      <b>{String(sectionHeadings.length).padStart(2, '0')}</b>
                    </header>
                    <nav aria-label="文档目录">
                      {sectionHeadings.map((heading, index) => (
                        <button
                          aria-current={activeHeadingId === heading.id ? 'location' : undefined}
                          className={`level-${heading.level}`}
                          key={heading.id}
                          onClick={() => jumpToHeading(heading.id)}
                          type="button"
                        >
                          <i>{String(index + 1).padStart(2, '0')}</i>
                          <span>{heading.text}</span>
                        </button>
                      ))}
                    </nav>
                    <footer>
                      <span>READING</span>
                      <b>{String(Math.round(progress * 100)).padStart(2, '0')}%</b>
                    </footer>
                  </aside>
                </div>
              </div>
            ) : (
              <div className="archive-reader-state">
                <span>DOCUMENT SOURCE UNAVAILABLE</span>
                <strong>{selectedMeta.label}暂时没有载入</strong>
                <p>{loadState === 'error'
                  ? '档案索引尚未可用；页面不会用本地副本冒充接口原文。'
                  : failedNames.includes(selectedName)
                    ? '索引仍然可见，但页面不会用缓存摘要冒充源文档。'
                    : '先从左侧索引选择一份档案。'}</p>
                <button onClick={() => setRequestKey((value) => value + 1)} type="button">
                  重新读取原文
                </button>
              </div>
            )}
          </section>
        </section>
      </main>

      <footer className="archive-page-footer">
        <span>FANISL / RESEARCH ARCHIVE</span>
        <p>预注册 → 时点正确 → 样本外裁决 → 研究遗产</p>
        <b>NEGATIVE RESULTS ARE ASSETS</b>
      </footer>
    </div>
  )
}

export default ArchivePage
