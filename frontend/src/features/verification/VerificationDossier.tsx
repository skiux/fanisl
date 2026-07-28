import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import EvidenceDossier from '../knowledge/EvidenceDossier'
import type {
  VerificationDetail,
  VerificationOutcome,
  VerificationPriceWindow,
} from './types'

const outcomeLabels: Record<VerificationOutcome, string> = {
  hit: '命中',
  partial: '部分',
  miss: '未中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '等待复核',
}

const outcomeMarks: Record<VerificationOutcome, string> = {
  hit: '✓',
  partial: '½',
  miss: '✗',
  condition_not_met: '○',
  condition_unverifiable: '?',
  unpriceable: '—',
  pending: '…',
}

const claimClassLabels: Record<string, string> = {
  price_target: '价位判断',
  directional: '方向判断',
  relative: '相对强弱',
  event_outcome: '事件结果',
  timing: '时点判断',
  risk_warning: '风险警示',
}

const directionLabels: Record<string, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
  range: '↔',
  vol_up: '波动↑',
  vol_down: '波动↓',
}

const verifiabilityLabels: Record<string, string> = {
  A: 'A级 · 全自动可评',
  B: 'B级 · 期限使用我方阶梯',
  C: 'C级 · 带条件按约定评',
  D: 'D级 · 不可评',
}

const stanceLabels: Record<string, string> = {
  explicit: '明确',
  hedged: '对冲表述',
  speculative: '试探表述',
}

const methodLabels: Record<string, string> = {
  sign: '方向符号',
  target_touch: '目标触及',
  target_close: '到期收盘',
  range_hold: '区间保持',
  relative_return: '相对收益',
}

const metricLabels: Record<string, string> = {
  ref: '发布参考',
  eval_close: '到期收盘',
  asset_ret: '标的收益',
  bench_ret: '基准收益',
  excess_ret: '超额收益',
  high: '区间最高',
  low: '区间最低',
  target: '判定目标',
  ladder: '评分阶梯',
  condition: '条件观测',
}

type LoadState = 'loading' | 'loaded' | 'error'
type PriceState = 'idle' | 'loading' | 'loaded' | 'error'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
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

function ClaimFact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return <span><small>{label}</small><strong>{value}</strong></span>
}

function VerificationPriceEvidence({ detail }: { detail: VerificationDetail }) {
  const symbol = asText(detail.payload.asset_symbol)
  const priceable = detail.payload.priceable !== false
  const [data, setData] = useState<VerificationPriceWindow | null>(null)
  const [state, setState] = useState<PriceState>('idle')

  useEffect(() => {
    if (!symbol || !priceable) {
      setData(null)
      setState('idle')
      return
    }

    const controller = new AbortController()
    const start = new Date(detail.published_at)
    start.setUTCDate(start.getUTCDate() - 7)
    const end = new Date(detail.eval_ts || detail.horizon_label)
    end.setUTCDate(end.getUTCDate() + 2)
    const params = new URLSearchParams({
      symbol,
      since: start.toISOString().slice(0, 10),
      until: end.toISOString().slice(0, 10),
    })
    setState('loading')
    setData(null)
    apiJson<VerificationPriceWindow>(`/knowledge/prices?${params.toString()}`, {
      signal: controller.signal,
    }).then((payload) => {
      setData(payload)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })
    return () => controller.abort()
  }, [detail.eval_ts, detail.horizon_label, detail.published_at, priceable, symbol])

  if (!symbol) return null

  const bars = data?.bars ?? []
  const magnitude = asRecord(detail.payload.magnitude)
  const thresholdLabels: Record<string, string> = {
    target: '目标',
    low: '下界',
    high: '上界',
    support: '支撑',
    resistance: '压力',
    stop: '止损',
  }
  const thresholdEntries = magnitude
    ? Object.entries(magnitude)
      .filter(([key]) => key in thresholdLabels)
      .map(([key, value]) => ({ key, value: asNumber(value) }))
      .filter((item): item is { key: string; value: number } => item.value !== null)
      .slice(0, 3)
    : []
  const width = 640
  const height = 236
  const left = 48
  const right = 16
  const top = 22
  const bottom = 34
  const reference = detail.ref_price_at_publish
  const values = [
    ...bars.flatMap((bar) => [bar.low, bar.high]),
    ...(reference === null ? [] : [reference]),
    ...thresholdEntries.map((entry) => entry.value),
  ]
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const range = Math.max(maximum - minimum, Math.abs(maximum) * .005, 1)
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const xForIndex = (index: number) => left + (index / Math.max(1, bars.length - 1)) * chartWidth
  const yForValue = (value: number) => top + ((maximum - value) / range) * chartHeight
  const points = bars.map((bar, index) => `${xForIndex(index)},${yForValue(bar.close)}`).join(' ')
  const targetDate = detail.horizon_label.slice(0, 10)
  const nextMarkerIndex = bars.findIndex((bar) => bar.ts.slice(0, 10) >= targetDate)
  const markerIndex = nextMarkerIndex >= 0 ? nextMarkerIndex : bars.length - 1
  const markerBar = bars[markerIndex] ?? bars[bars.length - 1]

  return (
    <section className="verification-price">
      <header>
        <div><p>价格证据</p><span>发布锚点、冻结判界与到期收盘</span></div>
        <b>{symbol}</b>
      </header>
      {!priceable && <p className="verification-price-empty">该判断在提取时被标记为不可定价。</p>}
      {priceable && state === 'loading' && (
        <div aria-label="正在读取价格证据" className="verification-price-loading"><i /><span /></div>
      )}
      {priceable && state === 'error' && (
        <p className="verification-price-empty">价格窗口暂时不可用；机械判定与实测字段仍完整保留。</p>
      )}
      {priceable && state === 'loaded' && bars.length === 0 && (
        <p className="verification-price-empty">该标的在判定窗口内没有可用日线。</p>
      )}
      {priceable && state === 'loaded' && bars.length > 0 && (
        <>
          <div className="verification-price-chart">
            <svg aria-label={`${symbol} 判定价格证据图`} role="img" viewBox={`0 0 ${width} ${height}`}>
              {[0, .5, 1].map((ratio) => {
                const y = top + ratio * chartHeight
                const value = maximum - ratio * range
                return (
                  <g className="verification-price-grid" key={ratio}>
                    <line x1={left} x2={width - right} y1={y} y2={y} />
                    <text x={left - 7} y={y + 3}>{value.toFixed(value < 100 ? 2 : 0)}</text>
                  </g>
                )
              })}
              {reference !== null && (
                <g className="verification-price-reference">
                  <line x1={left} x2={width - right} y1={yForValue(reference)} y2={yForValue(reference)} />
                  <text x={width - right} y={yForValue(reference) - 5}>发布 {reference.toFixed(2)}</text>
                </g>
              )}
              {thresholdEntries.map((entry) => (
                <g className="verification-price-threshold" key={entry.key}>
                  <line x1={left} x2={width - right} y1={yForValue(entry.value)} y2={yForValue(entry.value)} />
                  <text x={left + 5} y={yForValue(entry.value) - 5}>
                    {thresholdLabels[entry.key]} {entry.value}
                  </text>
                </g>
              ))}
              <polyline className="verification-price-line" points={points} />
              {markerBar && (
                <g className={`verification-price-verdict outcome-${detail.outcome}`}>
                  <line
                    x1={xForIndex(markerIndex)}
                    x2={xForIndex(markerIndex)}
                    y1={top}
                    y2={height - bottom}
                  />
                  <circle
                    cx={xForIndex(markerIndex)}
                    cy={yForValue(markerBar.close)}
                    r="5"
                  />
                  <text x={xForIndex(markerIndex)} y={top + 10}>
                    {outcomeLabels[detail.outcome]}
                  </text>
                </g>
              )}
              <text className="verification-price-date" x={left} y={height - 10}>{bars[0].ts.slice(5, 10)}</text>
              <text className="verification-price-date" textAnchor="end" x={width - right} y={height - 10}>
                {bars[bars.length - 1].ts.slice(5, 10)}
              </text>
            </svg>
          </div>
          <footer className="verification-price-legend">
            <span><i />收盘价</span>
            {reference !== null && <span><i />发布参考</span>}
            {thresholdEntries.length > 0 && <span><i />冻结判界</span>}
            <b>{data?.note || '日线收盘口径'}</b>
          </footer>
        </>
      )}
    </section>
  )
}

function VerificationDossier({
  onOpenUnit,
  scoreId,
}: {
  onOpenUnit: (unitId: number) => void
  scoreId: number
}) {
  const [detail, setDetail] = useState<VerificationDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setState('loading')
    apiJson<VerificationDetail>(`/knowledge/verifications/${scoreId}`, {
      signal: controller.signal,
    }).then((payload) => {
      setDetail(payload)
      setState('loaded')
    }).catch(() => {
      if (!controller.signal.aborted) setState('error')
    })
    return () => controller.abort()
  }, [requestKey, scoreId])

  const scoring = useMemo(() => asRecord(detail?.payload.scoring_spec), [detail])
  const realized = detail?.realized ? Object.entries(detail.realized) : []

  if (state === 'loading') {
    return <div aria-label="正在读取判定档案" className="verification-dossier-loading"><span /><b /><i /><i /></div>
  }
  if (state === 'error' || !detail) {
    return (
      <div className="verification-dossier-error">
        <span>VERDICT UNAVAILABLE</span>
        <strong>判定档案暂时没有载入</strong>
        <p>行动队列仍保留，重试不会改变当前筛选和阅读位置。</p>
        <button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取档案</button>
      </div>
    )
  }

  return (
    <article className={`verification-dossier outcome-${detail.outcome}`} key={detail.score_id}>
      <header className="verdict-lead">
        <div><span>VERDICT / {String(detail.score_id).padStart(3, '0')}</span><b>IMMUTABLE / L2</b></div>
        <section>
          <strong aria-hidden="true">{outcomeMarks[detail.outcome]}</strong>
          <p><span>机械裁决</span><b>{outcomeLabels[detail.outcome]}</b></p>
        </section>
      </header>

      <section className="verdict-quote">
        <span>原始判断</span>
        <blockquote>{detail.quote}</blockquote>
        <footer>
          <p>{detail.creator} · {detail.content_title}</p>
          <b>{detail.locator ? `定位 ${detail.locator}` : '全文文本'}</b>
        </footer>
      </section>

      <section className="verdict-route" aria-label="判定时间链">
        <span><small>发布</small><strong>{formatDate(detail.published_at)}</strong></span>
        <i />
        <span><small>冻结时点</small><strong>{detail.horizon_label}</strong></span>
        <i />
        <span><small>机械执行</small><strong>{formatDate(detail.eval_ts, true)}</strong></span>
      </section>

      <section className="realized-evidence">
        <header>
          <div><p>实测结果</p><span>评分器落库字段，不做事后修饰</span></div>
          <b>{outcomeLabels[detail.outcome]}</b>
        </header>
        {realized.length > 0 ? (
          <dl>
            {realized.map(([key, value]) => (
              <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{formatMetric(key, value)}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="realized-empty">该判定没有返回数值型实测字段。</p>
        )}
      </section>

      <section className="frozen-contract">
        <header>
          <div><p>冻结判据</p><span>提取时确定，到期后不重新解释</span></div>
          <b>SCORING CONTRACT</b>
        </header>
        <div className="frozen-facts">
          <ClaimFact label="标的" value={asText(detail.payload.asset_text) ?? asText(detail.payload.asset_symbol)} />
          <ClaimFact label="判断类型" value={claimClassLabels[asText(detail.payload.claim_class) ?? ''] ?? asText(detail.payload.claim_class)} />
          <ClaimFact label="方向" value={directionLabels[asText(detail.payload.direction) ?? ''] ?? asText(detail.payload.direction)} />
          <ClaimFact label="可验证性" value={verifiabilityLabels[asText(detail.payload.verifiability) ?? ''] ?? asText(detail.payload.verifiability)} />
          <ClaimFact label="承诺度" value={stanceLabels[asText(detail.payload.stance_strength) ?? ''] ?? asText(detail.payload.stance_strength)} />
          <ClaimFact label="评分方法" value={methodLabels[asText(scoring?.method) ?? ''] ?? asText(scoring?.method)} />
        </div>
        {asText(detail.payload.condition_text) && (
          <div className="frozen-condition">
            <span>前置条件</span><p>{asText(detail.payload.condition_text)}</p>
            <b>{detail.payload.condition_observable ? '可机械观察' : '不可机械观察'}</b>
          </div>
        )}
        <blockquote>{asText(scoring?.success_def) ?? '该档案未返回成功定义。'}</blockquote>
        <footer>
          <span>{asText(scoring?.benchmark) ? `比较基准 ${asText(scoring?.benchmark)}` : '单标的判定'}</span>
          <b>版本 {detail.scorer_version}</b>
        </footer>
      </section>

      <VerificationPriceEvidence detail={detail} />

      <section className="verdict-source">
        <header>
          <div><p>来源与影响</p><span>回到逐字证据，并查看这次裁决影响的长期节点</span></div>
          <b>PROVENANCE</b>
        </header>
        <article>
          <span>{detail.creator} · {formatDate(detail.published_at)}</span>
          <strong>{detail.content_title}</strong>
          <div>
            {detail.content_url && <a href={detail.content_url} rel="noreferrer" target="_blank">外部来源 ↗</a>}
            <button onClick={() => onOpenUnit(detail.unit_id)} type="button">核查完整证据单元 →</button>
          </div>
        </article>
        <div className="verdict-node-impact">
          <span>影响节点</span>
          {detail.nodes.length > 0 ? detail.nodes.map((node) => (
            <p key={node.id}><b>#{node.id} · {node.title}</b><em>{node.relation} / {node.status}</em></p>
          )) : <p><b>未归并到长期节点</b><em>该判断仍保留在单元层</em></p>}
        </div>
      </section>

      <footer className="verdict-provenance">
        <span>提取 {detail.extractor_version}</span>
        <span>评分 {detail.scorer_version}</span>
        <b>SCORED WITHOUT LLM</b>
      </footer>
    </article>
  )
}

export function VerificationReader({
  dueHorizon,
  dueUnitId,
  onCloseUnit,
  onOpenUnit,
  scoreId,
  unitOpen,
}: {
  dueHorizon: string | null
  dueUnitId: number | null
  onCloseUnit: () => void
  onOpenUnit: (unitId: number) => void
  scoreId: number | null
  unitOpen: number | null
}) {
  return (
    <>
      {scoreId !== null && <VerificationDossier onOpenUnit={onOpenUnit} scoreId={scoreId} />}
      {scoreId === null && dueUnitId !== null && (
        <div className="due-dossier">
          <header>
            <span>UPCOMING / {dueHorizon}</span>
            <strong>等待到期</strong>
            <p>判据已经冻结；到期前只观察，不提前解释结果。</p>
          </header>
          <EvidenceDossier
            embedded
            onClose={onCloseUnit}
            parentLabel="DUE"
            parentTitle={dueHorizon ?? ''}
            unitId={dueUnitId}
          />
        </div>
      )}
      {unitOpen !== null && (
        <EvidenceDossier
          backLabel="返回判定档案"
          onClose={onCloseUnit}
          parentLabel="VERDICT"
          parentTitle={scoreId === null ? dueHorizon ?? '' : `#${scoreId}`}
          unitId={unitOpen}
        />
      )}
    </>
  )
}

export default VerificationDossier
