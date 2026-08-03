import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiJson } from '../../shared/api/client'
import EvidenceDossier from './EvidenceDossier'
import type {
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentUnit,
  KnowledgeKind,
  UnitScore,
} from './types'
import './content-timeline.css'

const kindLabels: Record<KnowledgeKind, string> = {
  claim: '判断',
  method: '方法',
  concept: '认知',
}

const outcomeLabels: Record<string, string> = {
  hit: '命中',
  partial: '部分',
  miss: '未中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '等待',
}

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  rss: 'RSS',
  x: 'X',
  telegram: 'Telegram',
  manual: '手动归档',
}

const directionLabels: Record<string, string> = {
  up: '↑ 看多',
  down: '↓ 看空',
  flat: '→ 横盘',
  range: '↔ 区间',
  vol_up: '波动上升',
  vol_down: '波动下降',
}

const familyLabels: Record<string, string> = {
  trend: '趋势',
  reversion: '回归',
  carry: '套息',
  event: '事件',
  flow: '资金流',
  positioning: '仓位',
  other: '其他',
}

const categoryLabels: Record<string, string> = {
  risk_mgmt: '风险管理',
  psychology: '心理',
  market_structure: '市场结构',
  regime: '市场环境',
  execution: '执行',
  macro_framework: '宏观框架',
  other: '其他',
}

type ReaderLoad = 'idle' | 'loading' | 'loaded' | 'error'
type ContentPayload = {
  detail: KnowledgeContentDetail
  units: KnowledgeContentUnit[]
}

function formatDate(value: string | null | undefined) {
  if (!value) return { year: '—', monthDay: '日期未知', full: '日期未知' }
  const date = new Date(value)
  return {
    year: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      timeZone: 'Asia/Shanghai',
    }).format(date),
    monthDay: new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Shanghai',
    }).format(date),
    full: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Shanghai',
    }).format(date),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return null
}

function splitRaw(raw: string) {
  const marker = raw.search(/\n##\s*视觉笔记（画面信息，带时间戳）/)
  if (marker < 0) return { transcript: raw.trim(), visualNotes: '' }
  return {
    transcript: raw.slice(0, marker).trim(),
    visualNotes: raw.slice(marker).replace(/^\n##[^\n]*\n?/, '').trim(),
  }
}

function unitFacts(unit: KnowledgeContentUnit) {
  const payload = unit.payload
  if (unit.kind === 'claim') {
    const horizon = asRecord(payload.horizon)
    const duration = asText(horizon?.duration_days)
    const deadline = asText(horizon?.deadline)
    return [
      asText(payload.asset_symbol) ?? asText(payload.asset_text),
      directionLabels[asText(payload.direction) ?? ''] ?? asText(payload.direction),
      asText(payload.verifiability) ? `${asText(payload.verifiability)}级` : null,
      deadline ? `截至 ${deadline}` : duration ? `${duration} 天` : null,
    ].filter((item): item is string => Boolean(item))
  }
  if (unit.kind === 'method') {
    return [
      familyLabels[asText(payload.family) ?? ''] ?? asText(payload.family),
      asText(payload.testability) ? `可测试性 ${asText(payload.testability)}` : null,
    ].filter((item): item is string => Boolean(item))
  }
  return [
    categoryLabels[asText(payload.category) ?? ''] ?? asText(payload.category),
    asText(payload.regime_qualifier),
  ].filter((item): item is string => Boolean(item))
}

function ScoreMarks({ scores }: { scores: UnitScore[] }) {
  if (!scores.length) return <span className="content-score-pending">尚无到期裁决</span>
  return (
    <div className="content-score-marks" aria-label={`${scores.length} 个评分时点`}>
      {scores.map((score, index) => (
        <span className={`outcome-${score.outcome}`} key={`${score.horizon_label}-${index}`}>
          <b>{score.horizon_label}</b>
          <em>{outcomeLabels[score.outcome] ?? score.outcome}</em>
        </span>
      ))}
    </div>
  )
}

function ContentUnitEntry({
  index,
  onOpen,
  unit,
}: {
  index: number
  onOpen: (unitId: number) => void
  unit: KnowledgeContentUnit
}) {
  const facts = unitFacts(unit)

  return (
    <article className={`content-unit-entry kind-${unit.kind}`}>
      <header>
        <span><b>{String(index + 1).padStart(2, '0')}</b>{kindLabels[unit.kind]}</span>
        <p>{unit.locator ? `定位 ${unit.locator}` : `单元 #${unit.id}`}</p>
      </header>
      <blockquote>{unit.quote}</blockquote>
      {facts.length > 0 && (
        <div className="content-unit-facts">
          {facts.map((fact) => <span key={fact}>{fact}</span>)}
        </div>
      )}
      <footer>
        <div>
          {unit.kind === 'claim'
            ? <ScoreMarks scores={unit.scores} />
            : <span className="content-score-pending">不直接计入市场评分</span>}
        </div>
        <button onClick={() => onOpen(unit.id)} type="button">
          核查单元 <i>#{unit.id} →</i>
        </button>
      </footer>
    </article>
  )
}

function ReaderSkeleton() {
  return (
    <div aria-label="正在读取内容" className="content-reader-skeleton">
      <span /><b /><i /><i /><i />
    </div>
  )
}

function ContentReader({
  content,
  onRetry,
  onOpenUnit,
  payload,
  state,
}: {
  content: KnowledgeContentSummary
  onRetry: () => void
  onOpenUnit: (unitId: number) => void
  payload: ContentPayload | null
  state: ReaderLoad
}) {
  if (state === 'loading' || state === 'idle') return <ReaderSkeleton />
  if (state === 'error' || !payload) {
    return (
      <div className="content-reader-error">
        <span>CONTENT UNAVAILABLE</span>
        <strong>这期内容暂时没有载入</strong>
        <p>时间流索引仍可使用，重试不会改变当前内容位置。</p>
        <button onClick={onRetry} type="button">重新读取本期内容</button>
      </div>
    )
  }

  const { transcript, visualNotes } = splitRaw(payload.detail.raw)
  const grouped = {
    claim: payload.units.filter((unit) => unit.kind === 'claim'),
    method: payload.units.filter((unit) => unit.kind === 'method'),
    concept: payload.units.filter((unit) => unit.kind === 'concept'),
  }
  const date = formatDate(content.published_at)
  let unitIndex = 0

  return (
    <article className="content-reader-sheet">
      <header className="content-reader-lead">
        <div>
          <span>CONTENT / {String(content.id).padStart(3, '0')}</span>
          <b>{platformLabels[content.platform] ?? content.platform}</b>
        </div>
        <p>{content.creator} · {date.full}</p>
        <h2>{content.title}</h2>
        <section aria-label="内容提取摘要">
          <span><strong>{content.n_units}</strong><small>知识单元</small></span>
          <span><strong>{content.n_claims}</strong><small>判断</small></span>
          <span><strong>{content.n_methods}</strong><small>方法</small></span>
          <span><strong>{content.n_concepts}</strong><small>认知</small></span>
        </section>
      </header>

      <section className="content-reading-intro">
        <p>先读提取出的知识，再按需回到逐字原文。</p>
        {content.url && <a href={content.url} rel="noreferrer" target="_blank">访问原始来源 ↗</a>}
      </section>

      {(Object.keys(grouped) as KnowledgeKind[]).map((kind) => {
        const units = grouped[kind]
        if (!units.length) return null
        return (
          <section className={`content-unit-group group-${kind}`} key={kind}>
            <header>
              <div>
                <p>{kindLabels[kind]}</p>
                <span>
                  {kind === 'claim' && '未来可由市场裁决的表态'}
                  {kind === 'method' && '可复述、可讨论的操作规则'}
                  {kind === 'concept' && '可长期复用的认知框架'}
                </span>
              </div>
              <b>{units.length} 条</b>
            </header>
            <div>
              {units.map((unit) => {
                const index = unitIndex
                unitIndex += 1
                return <ContentUnitEntry index={index} key={unit.id} onOpen={onOpenUnit} unit={unit} />
              })}
            </div>
          </section>
        )
      })}

      <section className="content-source-archive">
        <header>
          <div>
            <p>原文档案</p>
            <span>L0 转录与画面信息保持不可变</span>
          </div>
          <b>{new Intl.NumberFormat('zh-CN').format(transcript.length)} 字</b>
        </header>
        <details>
          <summary><span>完整转录</span><b>展开阅读</b></summary>
          <div>{transcript}</div>
        </details>
        {visualNotes && (
          <details>
            <summary><span>画面信息与图表笔记</span><b>带时间戳</b></summary>
            <div className="content-visual-notes">{visualNotes}</div>
          </details>
        )}
      </section>

      <footer className="content-reader-foot">
        <span>提取版本可重放，原始表达不被覆盖</span>
        <b>SOURCE PRESERVED</b>
      </footer>
    </article>
  )
}

function ContentTimeline({
  contents,
  evidenceUnitId,
  isLoading,
  isPreview,
  onCloseEvidence,
  onCloseReader,
  onOpenEvidence,
  onSelectContent,
  readerOpen,
  selectedContentId,
}: {
  contents: KnowledgeContentSummary[]
  evidenceUnitId: number | null
  isLoading: boolean
  isPreview: boolean
  onCloseEvidence: () => void
  onCloseReader: () => void
  onOpenEvidence: (unitId: number) => void
  onSelectContent: (contentId: number, openOnMobile?: boolean) => void
  readerOpen: boolean
  selectedContentId: number | null
}) {
  const cacheRef = useRef(new Map<number, ContentPayload>())
  const [query, setQuery] = useState('')
  const [creatorId, setCreatorId] = useState<number | null>(null)
  const [payload, setPayload] = useState<ContentPayload | null>(null)
  const [readerState, setReaderState] = useState<ReaderLoad>('idle')
  const [readerRequestKey, setReaderRequestKey] = useState(0)

  const creatorCounts = useMemo(() => {
    const counts = new Map<number, { name: string; count: number }>()
    contents.forEach((content) => {
      const current = counts.get(content.creator_id)
      counts.set(content.creator_id, {
        name: content.creator,
        count: (current?.count ?? 0) + 1,
      })
    })
    return [...counts.entries()]
  }, [contents])

  const visibleContents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return contents.filter((content) => {
      if (creatorId !== null && content.creator_id !== creatorId) return false
      if (!normalized) return true
      return `${content.title} ${content.creator}`.toLocaleLowerCase().includes(normalized)
    })
  }, [contents, creatorId, query])

  const selectedContent = visibleContents.find((content) => content.id === selectedContentId)
    ?? visibleContents[0]
    ?? null

  const handleContentKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visibleContents.length - 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = visibleContents.length - 1
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const next = visibleContents[nextIndex]
    onSelectContent(next.id)
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-content-id="${next.id}"]`)?.focus()
    })
  }

  useEffect(() => {
    if (!selectedContent || isPreview) {
      setPayload(null)
      setReaderState('idle')
      return
    }

    const cached = cacheRef.current.get(selectedContent.id)
    if (cached) {
      setPayload(cached)
      setReaderState('loaded')
      return
    }

    const controller = new AbortController()
    setPayload(null)
    setReaderState('loading')
    Promise.all([
      apiJson<KnowledgeContentDetail>(`/knowledge/contents/${selectedContent.id}`, {
        signal: controller.signal,
      }),
      apiJson<KnowledgeContentUnit[]>(`/knowledge/contents/${selectedContent.id}/units`, {
        signal: controller.signal,
      }),
    ]).then(([detail, units]) => {
      const complete = { detail, units }
      cacheRef.current.set(selectedContent.id, complete)
      setPayload(complete)
      setReaderState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setReaderState('error')
    })

    return () => controller.abort()
  }, [isPreview, readerRequestKey, selectedContent])

  return (
    <>
      <aside className="content-library-rail">
        <header><span>CONTENT / FILTER</span></header>
        <section>
          <p>信源</p>
          <button aria-pressed={creatorId === null} onClick={() => setCreatorId(null)} type="button">
            <span>全部内容</span><b>{contents.length}</b>
          </button>
          {creatorCounts.map(([id, creator]) => (
            <button
              aria-pressed={creatorId === id}
              key={id}
              onClick={() => setCreatorId(id)}
              type="button"
            >
              <span>{creator.name}</span><b>{creator.count}</b>
            </button>
          ))}
        </section>
        <section>
          <p>内容状态</p>
          <div className="content-status-note">
            <i />
            <span>已提取</span>
            <b>{contents.filter((content) => content.status === 'extracted').length}</b>
          </div>
        </section>
        <footer>
          <span>{contents.reduce((sum, content) => sum + content.n_units, 0)} 个单元</span>
          <b>L0 → L1</b>
        </footer>
      </aside>

      <section className="content-catalog">
        <header>
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="搜索原始内容"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题或信源"
              value={query}
            />
            {query && <button aria-label="清空内容搜索" onClick={() => setQuery('')} type="button">×</button>}
          </label>
          <p><strong>{visibleContents.length}</strong> 期内容</p>
        </header>

        {isPreview && (
          <div className="content-preview-notice">
            <span>后端未连接，时间流需要真实内容接口才能阅读。</span>
          </div>
        )}

        <div className="content-stream" aria-busy={isLoading}>
          {isLoading && [0, 1, 2, 3].map((item) => (
            <div className="content-row content-row-skeleton" key={item}><i /><span /><span /></div>
          ))}
          {!isLoading && visibleContents.map((content, index) => {
            const date = formatDate(content.published_at)
            const scored = content.n_hit + content.n_partial + content.n_miss
            return (
              <button
                aria-pressed={selectedContent?.id === content.id}
                className="content-row"
                data-content-id={content.id}
                key={content.id}
                onClick={() => onSelectContent(content.id, true)}
                onKeyDown={(event) => handleContentKeyDown(event, index)}
                type="button"
              >
                <span className="content-date">
                  <b>{date.monthDay}</b>
                  <em>{date.year}</em>
                  <i />
                </span>
                <span className="content-row-body">
                  <span><b>{content.creator}</b><em>{platformLabels[content.platform] ?? content.platform}</em></span>
                  <strong>{content.title}</strong>
                  <span className="content-row-counts">
                    <span>{content.n_claims} 判断</span>
                    <span>{content.n_methods} 方法</span>
                    <span>{content.n_concepts} 认知</span>
                    <span>{scored ? `${scored} 裁决` : '等待裁决'}</span>
                  </span>
                </span>
                <small>{String(index + 1).padStart(2, '0')}</small>
              </button>
            )
          })}
          {!isLoading && visibleContents.length === 0 && (
            <div className="content-stream-empty">
              <span>NO MATCHED CONTENT</span>
              <strong>没有匹配的原始内容</strong>
              <p>调整检索词或信源条件。</p>
            </div>
          )}
        </div>
      </section>

      <aside className="content-reader" data-open={readerOpen}>
        <button className="content-reader-close" onClick={onCloseReader} type="button">
          <span>返回内容时间流</span><b>×</b>
        </button>
        {selectedContent && (
          <ContentReader
            content={selectedContent}
            onRetry={() => setReaderRequestKey((value) => value + 1)}
            onOpenUnit={onOpenEvidence}
            payload={payload}
            state={readerState}
          />
        )}
        {evidenceUnitId !== null && selectedContent && (
          <EvidenceDossier
            backLabel="返回本期内容"
            onClose={onCloseEvidence}
            parentLabel="CONTENT"
            parentTitle={selectedContent.title}
            unitId={evidenceUnitId}
          />
        )}
      </aside>
    </>
  )
}

export default ContentTimeline
