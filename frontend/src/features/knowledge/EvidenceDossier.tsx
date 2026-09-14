import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import {
  categoryLabels, claimClassLabels, directionLabels, familyLabels, gradeText, kindLabels, labelOf,
  outcomeLabels, realizedLabels, scoringMethodLabels, stanceLabels, testabilityLabels,
} from '../../shared/domain/labels'
import { nextTabIndex } from '../../shared/interaction/tabs'
import { useModalFocus } from '../../shared/interaction/useModalFocus'
import UnitReviews from './UnitReviews'
import type { EvidenceView } from './evidence-views'
import { announceReviewsChanged, fetchUnitReviews, unclosedCount, type UnitReview } from './reviews'
import type {
  KnowledgeContentDetail,
  KnowledgePriceWindow,
  KnowledgeUnitDetail,
  UnitScore,
} from './types'
import './evidence-dossier.css'

type LoadState = 'loading' | 'loaded' | 'error'
type ContentState = 'idle' | 'loading' | 'loaded' | 'error'
type PriceState = 'idle' | 'loading' | 'loaded' | 'error'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return null
}

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatDate(value: string | null | undefined, withYear = true) {
  if (!value) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function formatMetric(key: string, value: unknown) {
  if (typeof value === 'number') {
    if (key.endsWith('_ret') || key.includes('return')) {
      return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
    }
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function describeHorizon(value: unknown) {
  const horizon = asRecord(value)
  if (!horizon) return '未声明'
  const deadline = asText(horizon.deadline)
  const duration = asText(horizon.duration_days)
  if (deadline) return `截至 ${deadline}`
  if (duration) return `发布后 ${duration} 天`
  return asText(horizon.type) ?? '未声明'
}

function splitRaw(raw: string) {
  const marker = raw.search(/\n##\s*视觉笔记（画面信息，带时间戳）/)
  if (marker < 0) return { transcript: raw.trim(), visualNotes: '' }
  return {
    transcript: raw.slice(0, marker).trim(),
    visualNotes: raw.slice(marker).replace(/^\n##[^\n]*\n?/, '').trim(),
  }
}

function quoteContext(transcript: string, quote: string) {
  const index = transcript.indexOf(quote)
  if (index < 0) return { before: '', match: quote, after: '', found: false }
  const radius = 180
  return {
    before: `${index > radius ? '…' : ''}${transcript.slice(Math.max(0, index - radius), index)}`,
    match: quote,
    after: `${transcript.slice(index + quote.length, index + quote.length + radius)}${index + quote.length + radius < transcript.length ? '…' : ''}`,
    found: true,
  }
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function ClaimContract({ unit }: { unit: KnowledgeUnitDetail }) {
  const payload = unit.payload
  const scoring = asRecord(payload.scoring_spec)
  const ladder = asList(scoring?.eval_ladder)

  return (
    <section className="unit-contract claim-contract">
      <header>
        <div>
          <p>冻结判据</p>
          <span>发布时确定，评分时不再解释</span>
        </div>
        <b>SCORING CONTRACT</b>
      </header>

      <div className="contract-facts">
        <Fact label="标的" value={asText(payload.asset_symbol) ?? '未规范化'} />
        <Fact label="判断类型" value={labelOf(claimClassLabels, payload.claim_class)} />
        <Fact label="方向" value={labelOf(directionLabels, payload.direction)} />
        <Fact label="期限" value={describeHorizon(payload.horizon)} />
        <Fact label="承诺度" value={labelOf(stanceLabels, payload.stance_strength)} />
        <Fact label="可验证性" value={gradeText(payload.verifiability)} />
      </div>

      {/* 「标的」只放规范符号。asset_text 在 v2 里装的是定级理由（平均 51 字），另起一行完整给出 */}
      {asText(payload.asset_text) && asText(payload.asset_text) !== asText(payload.asset_symbol) && (
        <div className="contract-asset-note">
          <span>标的说明</span>
          <p>{asText(payload.asset_text)}</p>
        </div>
      )}

      {asText(payload.condition_text) && (
        <div className="contract-condition">
          <span>前置条件</span>
          <p>{asText(payload.condition_text)}</p>
          <b>{payload.condition_observable ? '可机械观察' : '不可机械观察'}</b>
        </div>
      )}

      {scoring ? (
        <div className="success-definition">
          <span>成功定义</span>
          <blockquote>{asText(scoring.success_def) ?? '未写入成功判据。'}</blockquote>
          <footer>
            <b>{labelOf(scoringMethodLabels, scoring.method) ?? '评分方法未声明'}</b>
            {asText(scoring.benchmark) && <em>基准 {asText(scoring.benchmark)}</em>}
          </footer>
          {ladder.length > 0 && (
            <div className="evaluation-ladder">
              <span>评分阶梯</span>
              <ol>
                {ladder.map((date, index) => (
                  <li key={date}>
                    <i />
                    <b>{date}</b>
                    <em>{index < ladder.length - 1 ? '等待后续时点' : '最终时点'}</em>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="contract-empty">该判断没有生成机械评分规格；这通常意味着语义、条件或标的不可验证。</p>
      )}
    </section>
  )
}

function MethodStructure({ unit }: { unit: KnowledgeUnitDetail }) {
  const payload = unit.payload
  const rules = asList(payload.rules)
  const requirements = asList(payload.data_requirements)
  const claimedPerformance = asText(payload.claimed_performance)

  return (
    <section className="unit-contract method-contract">
      <header>
        <div>
          <p>方法结构</p>
          <span>把口头经验保留为可复述规则</span>
        </div>
        <b>METHOD SPEC</b>
      </header>

      <div className="contract-facts">
        <Fact label="方法族" value={labelOf(familyLabels, payload.family)} />
        <Fact label="可测试性" value={asText(payload.testability) && `${asText(payload.testability)}级 · ${labelOf(testabilityLabels, payload.testability)}`} />
      </div>

      {asText(payload.summary) && <p className="method-summary">{asText(payload.summary)}</p>}
      {rules.length > 0 && (
        <div className="method-rules">
          <span>执行规则</span>
          <ol>
            {rules.map((rule, index) => (
              <li key={`${index}-${rule}`}><b>{String(index + 1).padStart(2, '0')}</b><p>{rule}</p></li>
            ))}
          </ol>
        </div>
      )}
      {requirements.length > 0 && (
        <div className="data-requirements">
          <span>所需数据</span>
          <p>{requirements.join(' · ')}</p>
        </div>
      )}
      {claimedPerformance && (
        <aside className="claimed-performance">
          <span>作者自述战绩 · 尚未采信</span>
          <p>{claimedPerformance}</p>
        </aside>
      )}
    </section>
  )
}

function ConceptStructure({ unit }: { unit: KnowledgeUnitDetail }) {
  const payload = unit.payload

  return (
    <section className="unit-contract concept-contract">
      <header>
        <div>
          <p>认知结构</p>
          <span>原始表达之外的归一化检索抓手</span>
        </div>
        <b>CONCEPT FRAME</b>
      </header>

      <div className="contract-facts">
        <Fact label="框架类型" value={labelOf(categoryLabels, payload.category)} />
        <Fact label="立场" value={asText(payload.stance) === 'reject' ? '否定' : asText(payload.stance) === 'assert' ? '主张' : asText(payload.stance)} />
        <Fact label="适用环境" value={asText(payload.regime_qualifier)} />
      </div>
      <blockquote className="concept-canonical">
        {asText(payload.canonical_statement) ?? '该单元没有独立的归一化表述。'}
      </blockquote>
    </section>
  )
}

function ScoreRecord({ score }: { score: UnitScore }) {
  const metrics = score.realized ? Object.entries(score.realized) : []

  return (
    <article className={`unit-score-record outcome-${score.outcome}`}>
      <header>
        <span>{score.horizon_label}</span>
        <b>{outcomeLabels[score.outcome] ?? score.outcome}</b>
      </header>
      {metrics.length > 0 && (
        <dl>
          {metrics.map(([key, value]) => (
            <div key={key}>
              <dt>{realizedLabels[key] ?? key}</dt>
              <dd>{formatMetric(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

function ScoreSection({ unit }: { unit: KnowledgeUnitDetail }) {
  return (
    <section className="unit-score-section">
      <header>
        <div>
          <p>市场裁决</p>
          <span>机械执行冻结判据，不在到期后重新解释</span>
        </div>
        <b>{unit.scores.length} 个时点</b>
      </header>
      {unit.scores.length > 0 ? (
        <div className="unit-score-list">
          {unit.scores.map((score, index) => (
            <ScoreRecord key={`${score.horizon_label}-${index}`} score={score} />
          ))}
        </div>
      ) : (
        <p className="unit-score-empty">
          {unit.kind === 'claim'
            ? '尚无到期评分；空白不等于 0%，只表示评分时点尚未到来或该判断不可评分。'
            : '方法与认知不直接计分；它们通过后续回测、重申与关系演进接受检验。'}
        </p>
      )}
    </section>
  )
}

function PriceEvidence({ unit }: { unit: KnowledgeUnitDetail }) {
  const symbol = asText(unit.payload.asset_symbol)
  const priceable = unit.payload.priceable !== false
  const [windowData, setWindowData] = useState<KnowledgePriceWindow | null>(null)
  const [state, setState] = useState<PriceState>('idle')

  useEffect(() => {
    if (!symbol || !priceable) {
      setState('idle')
      setWindowData(null)
      return
    }

    const controller = new AbortController()
    const start = new Date(unit.published_at)
    start.setUTCDate(start.getUTCDate() - 7)
    const since = start.toISOString().slice(0, 10)
    const until = new Date().toISOString().slice(0, 10)
    const params = new URLSearchParams({ symbol, since, until })
    setState('loading')
    setWindowData(null)

    apiJson<KnowledgePriceWindow>(`/knowledge/prices?${params.toString()}`, {
      signal: controller.signal,
    }).then((payload) => {
      setWindowData(payload)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })

    return () => controller.abort()
  }, [priceable, symbol, unit.published_at])

  if (!symbol) return null

  const bars = windowData?.bars ?? []
  const width = 600
  const height = 220
  const left = 44
  const right = 14
  const top = 18
  const bottom = 34
  const closes = bars.map((bar) => bar.close)
  const lows = bars.map((bar) => bar.low)
  const highs = bars.map((bar) => bar.high)
  const reference = unit.ref_price_at_publish
  const values = [...lows, ...highs, ...(reference === null ? [] : [reference])]
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const range = Math.max(maximum - minimum, Math.abs(maximum) * 0.005, 1)
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const xForIndex = (index: number) => left + (index / Math.max(1, bars.length - 1)) * chartWidth
  const yForValue = (value: number) => top + ((maximum - value) / range) * chartHeight
  const points = closes.map((close, index) => `${xForIndex(index)},${yForValue(close)}`).join(' ')
  const scorePoints = unit.scores.map((score) => {
    const target = score.horizon_label.slice(0, 10)
    const nextTradingDay = bars.findIndex((bar) => bar.ts.slice(0, 10) >= target)
    const index = nextTradingDay >= 0 ? nextTradingDay : bars.length - 1
    return { index, score }
  })

  return (
    <section className="price-evidence">
      <header>
        <div>
          <p>价格证据</p>
          <span>发布参考价、到期时点与真实日线窗口</span>
        </div>
        <b>{symbol}</b>
      </header>

      {!priceable && (
        <p className="price-evidence-empty">该判断在提取时被标记为不可定价，因此不生成价格图。</p>
      )}
      {priceable && state === 'loading' && (
        <div aria-label="正在读取价格证据" className="price-chart-loading"><i /><span /></div>
      )}
      {priceable && state === 'error' && (
        <p className="price-evidence-empty">当前价格窗口暂时不可用；冻结判据与已有评分仍保留在下方。</p>
      )}
      {priceable && state === 'loaded' && bars.length === 0 && (
        <p className="price-evidence-empty">该标的当前没有可用的日线窗口。</p>
      )}
      {priceable && state === 'loaded' && bars.length > 0 && (
        <>
          <div className="price-chart">
            <svg aria-label={`${symbol} 价格证据图`} role="img" viewBox={`0 0 ${width} ${height}`}>
              {[0, .5, 1].map((ratio) => {
                const y = top + ratio * chartHeight
                const value = maximum - ratio * range
                return (
                  <g className="price-grid-line" key={ratio}>
                    <line x1={left} x2={width - right} y1={y} y2={y} />
                    <text x={left - 7} y={y + 3}>{value.toFixed(value < 100 ? 2 : 0)}</text>
                  </g>
                )
              })}
              {reference !== null && (
                <g className="price-reference">
                  <line x1={left} x2={width - right} y1={yForValue(reference)} y2={yForValue(reference)} />
                  <text x={width - right} y={yForValue(reference) - 5}>发布参考 {reference.toFixed(2)}</text>
                </g>
              )}
              <polyline className="price-close-line" points={points} />
              {scorePoints.map(({ index, score }, scoreIndex) => {
                const bar = bars[index]
                if (!bar) return null
                const x = xForIndex(index)
                const y = yForValue(bar.close)
                return (
                  <g className={`price-score-point outcome-${score.outcome}`} key={`${score.horizon_label}-${scoreIndex}`}>
                    <line x1={x} x2={x} y1={top} y2={height - bottom} />
                    <circle cx={x} cy={y} r="4" />
                    <text x={x} y={top + 10}>{outcomeLabels[score.outcome] ?? score.outcome}</text>
                  </g>
                )
              })}
              <text className="price-axis-date" x={left} y={height - 10}>{bars[0].ts.slice(5, 10)}</text>
              <text className="price-axis-date" textAnchor="end" x={width - right} y={height - 10}>
                {bars[bars.length - 1].ts.slice(5, 10)}
              </text>
            </svg>
          </div>
          <footer className="price-evidence-legend">
            <span><i />收盘价</span>
            {reference !== null && <span><i />发布参考价</span>}
            <b>{windowData?.note || '日线收盘口径'}</b>
          </footer>
        </>
      )}
    </section>
  )
}

function SourceReader({
  content,
  unit,
}: {
  content: KnowledgeContentDetail
  unit: KnowledgeUnitDetail
}) {
  const { transcript, visualNotes } = useMemo(() => splitRaw(content.raw), [content.raw])
  const context = useMemo(() => quoteContext(transcript, unit.quote), [transcript, unit.quote])

  return (
    <div className="source-reader">
      <section className="quote-location">
        <header>
          <span>逐字原文定位</span>
          <b>{unit.locator ? `时间 ${unit.locator}` : '文本原位'}</b>
        </header>
        <blockquote>
          {context.before && <span>{context.before}</span>}
          <mark>{context.match}</mark>
          {context.after && <span>{context.after}</span>}
        </blockquote>
        {!context.found && (
          <p>当前全文版本未找到完全一致的字面位置，保留已入库的机械校验引文。</p>
        )}
      </section>

      <details className="full-transcript">
        <summary>
          <span>完整转录</span>
          <b>{new Intl.NumberFormat('zh-CN').format(transcript.length)} 字</b>
        </summary>
        <div>{transcript}</div>
      </details>

      {visualNotes && (
        <details className="visual-notes">
          <summary>
            <span>画面信息与图表笔记</span>
            <b>带时间戳</b>
          </summary>
          <div>{visualNotes}</div>
        </details>
      )}
    </div>
  )
}

function ContentGateway({ unit }: { unit: KnowledgeUnitDetail }) {
  const [content, setContent] = useState<KnowledgeContentDetail | null>(null)
  const [state, setState] = useState<ContentState>('idle')
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [])

  const loadContent = () => {
    if (state === 'loading') return
    if (state === 'loaded') {
      setState('idle')
      return
    }
    if (content) {
      setState('loaded')
      return
    }

    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setState('loading')
    apiJson<KnowledgeContentDetail>(`/knowledge/contents/${unit.content_id}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setContent(payload)
        setState('loaded')
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error')
      })
  }

  return (
    <section className="content-gateway">
      <header>
        <div>
          <p>原始内容</p>
          <span>L0 不可变来源</span>
        </div>
        <b>CONTENT / {String(unit.content_id).padStart(3, '0')}</b>
      </header>

      <article>
        <span>{unit.creator} · {formatDate(unit.published_at)}</span>
        <strong>{unit.content_title}</strong>
        <div>
          {unit.content_url && (
            <a href={unit.content_url} rel="noreferrer" target="_blank">访问外部来源 ↗</a>
          )}
          <button
            aria-expanded={state === 'loaded'}
            onClick={loadContent}
            type="button"
          >
            {state === 'loaded' ? '收起原始内容' : state === 'loading' ? '正在读取全文…' : '核查原始内容'}
            {state !== 'loading' && <i>{state === 'loaded' ? '↑' : '↓'}</i>}
          </button>
        </div>
      </article>

      {state === 'error' && (
        <div className="content-error">
          <p>原始内容暂时没有载入，证据单元仍可独立核查。</p>
          <button onClick={loadContent} type="button">重新读取全文</button>
        </div>
      )}
      {state === 'loaded' && content && <SourceReader content={content} unit={unit} />}
    </section>
  )
}

function DossierSkeleton() {
  return (
    <div aria-label="正在读取证据单元" className="dossier-skeleton">
      <span /><b /><i /><i /><i />
    </div>
  )
}

function EvidenceDossier({
  backLabel = '返回知识节点',
  embedded = false,
  focusReviewId = null,
  initialView = 'structure',
  onClose,
  parentLabel = 'NODE',
  parentTitle,
  unitId,
}: {
  backLabel?: string
  embedded?: boolean
  /** 从「待确认」进来时滚到那一条核查。 */
  focusReviewId?: number | null
  /** 打开时落在哪个 tab；换单元时回到它。 */
  initialView?: EvidenceView
  onClose: () => void
  parentLabel?: string
  parentTitle: string
  unitId: number
}) {
  const [unit, setUnit] = useState<KnowledgeUnitDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)
  const [activeView, setActiveView] = useState<EvidenceView>(initialView)
  const [reviewRequest, setReviewRequest] = useState(0)
  // 核查记录连同"属于哪个单元、哪一次请求"一起存：换了单元或点了重试，旧数据自然作废、显示读取中，
  // 不必在 effect 里先同步清空一遍
  const [reviewData, setReviewData] = useState<{
    unitId: number
    request: number
    reviews: UnitReview[] | null
    state: LoadState
  } | null>(null)
  const reviewsCurrent = reviewData !== null && reviewData.unitId === unitId && reviewData.request === reviewRequest
  const reviews = reviewsCurrent && reviewData ? reviewData.reviews : null
  const reviewState: LoadState = reviewsCurrent && reviewData ? reviewData.state : 'loading'
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dossierRef = useRef<HTMLElement>(null)
  useModalFocus(dossierRef, !embedded, onClose)

  useEffect(() => {
    const controller = new AbortController()
    setUnit(null)
    setState('loading')

    apiJson<KnowledgeUnitDetail>(`/knowledge/units/${unitId}`, {
      signal: controller.signal,
    }).then((payload) => {
      setUnit(payload)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })

    return () => controller.abort()
  }, [requestKey, unitId])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    setActiveView(initialView)
    if (!embedded) closeRef.current?.focus({ preventScroll: true })
  }, [embedded, initialView, unitId])

  // tab 上要显示未关闭的核查数，所以打开单元就取，不等点进「核查」
  useEffect(() => {
    const controller = new AbortController()
    fetchUnitReviews(unitId, controller.signal)
      .then((payload) => setReviewData({ unitId, request: reviewRequest, reviews: payload, state: 'loaded' }))
      .catch(() => {
        if (!controller.signal.aborted) setReviewData({ unitId, request: reviewRequest, reviews: null, state: 'error' })
      })
    return () => controller.abort()
  }, [reviewRequest, unitId])

  const handleReviewChanged = (next: UnitReview) => {
    // 先把接口返回的那一条换进列表（新提交的放最前），再静默重取一次与服务端对齐
    const merge = (list: UnitReview[]) => (list.some((item) => item.id === next.id)
      ? list.map((item) => (item.id === next.id ? next : item))
      : [next, ...list])
    setReviewData((data) => ({
      unitId: next.unit_id,
      request: reviewRequest,
      reviews: merge(data !== null && data.unitId === next.unit_id ? data.reviews ?? [] : []),
      state: 'loaded',
    }))
    announceReviewsChanged()
    fetchUnitReviews(next.unit_id)
      // 重取回来时用户可能已经换了单元：只写回同一个单元
      .then((payload) => setReviewData((data) => (data !== null && data.unitId === next.unit_id
        ? { ...data, reviews: payload, state: 'loaded' }
        : data)))
      .catch(() => { /* 本地已换上接口返回的那条，重取失败不打扰 */ })
  }

  const openReviews = reviews ? unclosedCount(reviews) : 0

  return (
    <section
      aria-label={`证据单元 ${unitId}`}
      aria-modal={embedded ? undefined : true}
      className={`evidence-dossier${embedded ? ' is-embedded' : ''}`}
      ref={dossierRef}
      role={embedded ? 'region' : 'dialog'}
    >
      {!embedded && (
        <header className="dossier-navigation">
          <button onClick={onClose} ref={closeRef} type="button">
            <i>←</i>
            <span>{backLabel}</span>
          </button>
          <p>{parentLabel} <b>{parentTitle}</b></p>
        </header>
      )}

      <div className="dossier-body" ref={bodyRef}>
        {state === 'loading' && <DossierSkeleton />}
        {state === 'error' && (
          <div className="dossier-error">
            <span>EVIDENCE UNAVAILABLE</span>
            <strong>证据单元暂时没有载入</strong>
            <p>节点和提及仍然保留在上一层，重试不会改变当前阅读位置。</p>
            <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取单元</button>
          </div>
        )}

        {state === 'loaded' && unit && (
          <article className={`unit-dossier kind-${unit.kind}`}>
            <header className="unit-lead">
              <div>
                <span>UNIT / {String(unit.id).padStart(3, '0')}</span>
                <b>L1 / EVIDENCE</b>
              </div>
              <p>
                <em>{kindLabels[unit.kind]}</em>
                <strong>{unit.creator}</strong>
                <time>{formatDate(unit.published_at)}</time>
              </p>
            </header>
            <div className="unit-review-layout">
              <aside className="unit-evidence-anchor">
                <section className="unit-quote">
                  <span>逐字证据</span>
                  <blockquote>{unit.quote}</blockquote>
                  <footer>
                    <p>{unit.content_title}</p>
                    <b>{unit.locator ? `定位 ${unit.locator}` : '全文文本'}</b>
                  </footer>
                </section>
                <div className="unit-tags">{unit.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                <footer className="unit-provenance">
                  <div><span>提取版本</span><b>{unit.extractor_version}</b></div>
                  <div><span>提取模型</span><b>{unit.model ?? '未记录'}</b></div>
                  <strong>QUOTE VERIFIED IN SOURCE</strong>
                </footer>
              </aside>

              <section className="unit-analysis-workspace">
                <nav
                  aria-label="证据核查视图"
                  className="dossier-section-tabs"
                  onKeyDown={(event) => {
                    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                    const index = tabs.indexOf(event.target as HTMLButtonElement)
                    const next = nextTabIndex(event.key, index, tabs.length)
                    if (next === null) return
                    event.preventDefault()
                    tabs[next].click()
                    tabs[next].focus()
                  }}
                  role="tablist"
                >
                  {([
                    ['structure', '结构化结论', '01'],
                    ['verdict', '市场裁决', '02'],
                    ['source', '原文上下文', '03'],
                    ['review', '核查', '04'],
                  ] as const).map(([value, label, ordinal]) => {
                    // 有未关闭的核查时，序号位换成计数；没有就与其余 tab 一样只是序号
                    const count = value === 'review' && openReviews > 0 ? openReviews : null
                    return (
                      <button
                        aria-controls={`unit-${unitId}-panel-${value}`}
                        aria-label={count ? `${label}，${count} 条未关闭` : undefined}
                        aria-selected={activeView === value}
                        id={`unit-${unitId}-tab-${value}`}
                        key={value}
                        onClick={() => setActiveView(value)}
                        role="tab"
                        tabIndex={activeView === value ? 0 : -1}
                        type="button"
                      >
                        <span>{label}</span>
                        {count ? <b className="dossier-tab-count">{count}</b> : <b>{ordinal}</b>}
                      </button>
                    )
                  })}
                </nav>
                <div aria-labelledby={`unit-${unitId}-tab-${activeView}`} className="dossier-section-content" id={`unit-${unitId}-panel-${activeView}`} role="tabpanel" tabIndex={0}>
                  {activeView === 'structure' && <div className="dossier-view dossier-structure-view">
                    {unit.kind === 'claim' && <ClaimContract unit={unit} />}
                    {unit.kind === 'method' && <MethodStructure unit={unit} />}
                    {unit.kind === 'concept' && <ConceptStructure unit={unit} />}
                  </div>}
                  {activeView === 'verdict' && <div className="dossier-view dossier-verdict-view">{unit.kind === 'claim' && <PriceEvidence unit={unit} />}<ScoreSection unit={unit} /></div>}
                  {activeView === 'source' && <div className="dossier-view dossier-source-view"><ContentGateway key={unit.id} unit={unit} /></div>}
                  {activeView === 'review' && (
                    <div className="dossier-view dossier-review-view">
                      <UnitReviews
                        focusReviewId={focusReviewId}
                        onChanged={handleReviewChanged}
                        onRetry={() => setReviewRequest((value) => value + 1)}
                        reviews={reviews}
                        state={reviewState}
                        unitId={unit.id}
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}

export default EvidenceDossier
