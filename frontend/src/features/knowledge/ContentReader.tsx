import { useEffect, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import type {
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentUnit,
  KnowledgeKind,
  UnitScore,
} from './types'
import './content-reader.css'

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

export type ContentPayloadShape = ContentPayload
export type ContentReaderState = ReaderLoad

export function ContentReader({
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
          <span>本期内容</span>
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
        <b>原文不可变</b>
      </footer>
    </article>
  )
}

export function useContentDetail(contentId: number | null) {
  const cacheRef = useRef(new Map<number, ContentPayload>())
  const [payload, setPayload] = useState<ContentPayload | null>(null)
  const [state, setState] = useState<ReaderLoad>('idle')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    if (contentId === null) {
      setPayload(null)
      setState('idle')
      return
    }
    const cached = cacheRef.current.get(contentId)
    if (cached) {
      setPayload(cached)
      setState('loaded')
      return
    }
    const controller = new AbortController()
    setPayload(null)
    setState('loading')
    Promise.all([
      apiJson<KnowledgeContentDetail>(`/knowledge/contents/${contentId}`, { signal: controller.signal }),
      apiJson<KnowledgeContentUnit[]>(`/knowledge/contents/${contentId}/units`, { signal: controller.signal }),
    ]).then(([detail, units]) => {
      const complete = { detail, units }
      cacheRef.current.set(contentId, complete)
      setPayload(complete)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })
    return () => controller.abort()
  }, [contentId, requestKey])

  return { payload, state, retry: () => setRequestKey((value) => value + 1) }
}

export { platformLabels }
