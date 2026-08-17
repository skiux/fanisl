import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import EvidenceDossier from '../knowledge/EvidenceDossier'
import type {
  DueVerification,
  VerificationDetail,
  VerificationOutcome,
  VerificationPriceWindow,
} from './types'

const outcomeLabels: Record<VerificationOutcome, string> = {
  hit: '命中',
  partial: '部分命中',
  miss: '未命中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无法取价',
  pending: '等待确认',
}

const outcomeMarks: Record<VerificationOutcome, string> = {
  hit: '✓',
  partial: '½',
  miss: '×',
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
  up: '↑ 上行',
  down: '↓ 下行',
  flat: '→ 横向',
  range: '↔ 区间',
  vol_up: '波动上升',
  vol_down: '波动下降',
}

const verifiabilityLabels: Record<string, string> = {
  A: 'A级 · 全自动可评',
  B: 'B级 · 我方评分阶梯',
  C: 'C级 · 按约定条件评',
  D: 'D级 · 不可机械评',
}

const stanceLabels: Record<string, string> = {
  explicit: '明确表述',
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
  relative_ret: '相对收益',
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
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return '日期未知'
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
    if (key.endsWith('_ret') || key.includes('return')) return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function ClaimFact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return <span><small>{label}</small><strong>{value}</strong></span>
}

function FrozenContract({ payload, scorerVersion }: { payload: Record<string, unknown>; scorerVersion?: string }) {
  const scoring = asRecord(payload.scoring_spec)
  return (
    <section className="frozen-contract">
      <header><div><p>冻结判据</p><span>发布时确定，到期后不重新解释</span></div><b>SCORING CONTRACT</b></header>
      <div className="frozen-facts">
        <ClaimFact label="标的" value={asText(payload.asset_text) ?? asText(payload.asset_symbol)} />
        <ClaimFact label="判断类型" value={claimClassLabels[asText(payload.claim_class) ?? ''] ?? asText(payload.claim_class)} />
        <ClaimFact label="方向" value={directionLabels[asText(payload.direction) ?? ''] ?? asText(payload.direction)} />
        <ClaimFact label="可验证性" value={verifiabilityLabels[asText(payload.verifiability) ?? ''] ?? asText(payload.verifiability)} />
        <ClaimFact label="承诺度" value={stanceLabels[asText(payload.stance_strength) ?? ''] ?? asText(payload.stance_strength)} />
        <ClaimFact label="评分方法" value={methodLabels[asText(scoring?.method) ?? ''] ?? asText(scoring?.method)} />
      </div>
      {asText(payload.condition_text) && (
        <div className="frozen-condition"><span>前置条件</span><p>{asText(payload.condition_text)}</p><b>{payload.condition_observable ? '可机械观察' : '不可机械观察'}</b></div>
      )}
      <div className="frozen-definition"><span>成功定义</span><blockquote>{asText(scoring?.success_def) ?? '该档案未返回成功定义。'}</blockquote></div>
      <footer><span>{asText(scoring?.benchmark) ? `比较基准 ${asText(scoring?.benchmark)}` : '单标的判定'}</span>{scorerVersion && <b>评分器 {scorerVersion}</b>}</footer>
    </section>
  )
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
    apiJson<VerificationPriceWindow>(`/knowledge/prices?${params.toString()}`, { signal: controller.signal })
      .then((payload) => { setData(payload); setState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [detail.eval_ts, detail.horizon_label, detail.published_at, priceable, symbol])

  if (!symbol) return null
  const bars = data?.bars ?? []
  const magnitude = asRecord(detail.payload.magnitude)
  const thresholdLabels: Record<string, string> = { target: '目标', low: '下界', high: '上界', support: '支撑', resistance: '压力', stop: '止损' }
  const thresholds = magnitude
    ? Object.entries(magnitude).filter(([key]) => key in thresholdLabels).flatMap(([key, value]) => {
      const number = asNumber(value)
      return number === null ? [] : [{ key, value: number }]
    }).slice(0, 3)
    : []
  const width = 640
  const height = 214
  const left = 46
  const right = 16
  const top = 20
  const bottom = 30
  const reference = detail.ref_price_at_publish
  const values = [...bars.flatMap((bar) => [bar.low, bar.high]), ...(reference === null ? [] : [reference]), ...thresholds.map((entry) => entry.value)]
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const range = Math.max(maximum - minimum, Math.abs(maximum) * .005, 1)
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const xForIndex = (index: number) => left + (index / Math.max(1, bars.length - 1)) * chartWidth
  const yForValue = (value: number) => top + ((maximum - value) / range) * chartHeight
  const points = bars.map((bar, index) => `${xForIndex(index)},${yForValue(bar.close)}`).join(' ')
  // 到期时点落在哪根 K 上。找不到（日线止于 horizon 之前——例如当日评分时那根未收盘的
  // K 已被行情接口丢掉）就退到最后一根，绝不能退到第 0 根：那会把裁决画在窗口最左端。
  const horizonIndex = bars.findIndex((bar) => bar.ts.slice(0, 10) >= detail.horizon_label.slice(0, 10))
  const markerIndex = horizonIndex === -1 ? bars.length - 1 : horizonIndex
  const markerBar = bars[markerIndex] ?? null
  const markerIsApproximate = horizonIndex === -1

  return (
    <section className="verification-price">
      <header><div><p>价格证据</p><span>发布锚点、冻结判界与到期收盘</span></div><b>{symbol}</b></header>
      {!priceable && <p className="verification-price-empty">该判断在提取时被标记为不可定价。</p>}
      {priceable && state === 'loading' && <div aria-label="正在读取价格证据" className="verification-price-loading"><i /><span /></div>}
      {priceable && state === 'error' && <p className="verification-price-empty">价格窗口暂时不可用；机械判定和实测字段仍完整保留。</p>}
      {priceable && state === 'loaded' && bars.length === 0 && <p className="verification-price-empty">判定窗口内没有可用日线。</p>}
      {priceable && state === 'loaded' && bars.length > 0 && (
        <>
          <div className="verification-price-chart">
            <svg aria-label={`${symbol} 判定价格证据图`} role="img" viewBox={`0 0 ${width} ${height}`}>
              {[0, .5, 1].map((ratio) => {
                const y = top + ratio * chartHeight
                return <g className="verification-price-grid" key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 7} y={y + 3}>{(maximum - ratio * range).toFixed(maximum < 100 ? 2 : 0)}</text></g>
              })}
              {reference !== null && <g className="verification-price-reference"><line x1={left} x2={width - right} y1={yForValue(reference)} y2={yForValue(reference)} /><text x={width - right} y={yForValue(reference) - 5}>发布 {reference.toFixed(2)}</text></g>}
              {thresholds.map((entry) => <g className="verification-price-threshold" key={entry.key}><line x1={left} x2={width - right} y1={yForValue(entry.value)} y2={yForValue(entry.value)} /><text x={left + 5} y={yForValue(entry.value) - 5}>{thresholdLabels[entry.key]} {entry.value}</text></g>)}
              <polyline className="verification-price-line" points={points} />
              {markerBar && <g className={`verification-price-verdict outcome-${detail.outcome}`}><line x1={xForIndex(markerIndex)} x2={xForIndex(markerIndex)} y1={top} y2={height - bottom} /><circle cx={xForIndex(markerIndex)} cy={yForValue(markerBar.close)} r="5" /><text x={xForIndex(markerIndex)} y={top + 10}>{outcomeLabels[detail.outcome]}</text></g>}
              <text className="verification-price-date" x={left} y={height - 8}>{bars[0].ts.slice(5, 10)}</text>
              <text className="verification-price-date" textAnchor="end" x={width - right} y={height - 8}>{bars[bars.length - 1].ts.slice(5, 10)}</text>
            </svg>
          </div>
          <footer className="verification-price-legend"><span><i />收盘价</span><span><i />发布参考</span>{thresholds.length > 0 && <span><i />冻结判界</span>}<b>{markerIsApproximate ? `日线止于 ${bars[bars.length - 1].ts.slice(0, 10)}，裁决标记画在最后一根可用日线上` : data?.note || '日线收盘口径'}</b></footer>
        </>
      )}
    </section>
  )
}

function VerificationDossier({ onOpenUnit, scoreId }: { onOpenUnit: (unitId: number) => void; scoreId: number }) {
  const [detail, setDetail] = useState<VerificationDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setState('loading')
    apiJson<VerificationDetail>(`/knowledge/verifications/${scoreId}`, { signal: controller.signal })
      .then((payload) => { setDetail(payload); setState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [requestKey, scoreId])

  const realized = useMemo(() => detail?.realized ? Object.entries(detail.realized) : [], [detail])

  if (state === 'loading') return <div aria-label="正在读取判定档案" className="verification-dossier-loading"><span /><b /><i /><i /></div>
  if (state === 'error' || !detail) return <div className="verification-dossier-error"><span>VERDICT UNAVAILABLE</span><strong>判定档案暂时没有载入</strong><p>验证日志仍然保留，重试不会改写当前记录。</p><button onClick={() => setRequestKey((value) => value + 1)} type="button">重新读取档案</button></div>

  return (
    <article className={`verification-dossier outcome-${detail.outcome}`}>
      <header className="verdict-record-lead">
        <div className="verdict-record-id"><span>VERDICT / {String(detail.score_id).padStart(3, '0')}</span><b>IMMUTABLE / L2</b></div>
        <section className="verdict-record-result"><strong aria-hidden="true">{outcomeMarks[detail.outcome]}</strong><p><span>机械裁决</span><b>{outcomeLabels[detail.outcome]}</b></p></section>
        <div className="verdict-record-meta"><span><small>发布</small><b>{formatDate(detail.published_at)}</b></span><span><small>评分时点</small><b>{detail.horizon_label}</b></span><span><small>执行</small><b>{formatDate(detail.eval_ts, true)}</b></span></div>
      </header>

      <div className="verdict-workspace">
        <section className="verdict-primary-pane">
          <section className="verdict-quote"><span>原始判断 / VERBATIM</span><blockquote>{detail.quote}</blockquote><footer><p>{detail.creator} · {detail.content_title}</p><b>{detail.locator ? `定位 ${detail.locator}` : '全文文本'}</b></footer></section>
          <FrozenContract payload={detail.payload} scorerVersion={detail.scorer_version} />
        </section>

        <section className="verdict-evidence-pane">
          <section className="realized-evidence">
            <header><div><p>实测结果</p><span>评分器落库字段，不做事后修饰</span></div><b>{outcomeLabels[detail.outcome]}</b></header>
            {realized.length > 0 ? <dl>{realized.map(([key, value]) => <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{formatMetric(key, value)}</dd></div>)}</dl> : <p className="realized-empty">该判定没有返回数值型实测字段。</p>}
          </section>
          <VerificationPriceEvidence detail={detail} />
          <section className="verdict-source">
            <header><div><p>来源与影响</p><span>回到逐字证据，核对完整上下文</span></div><b>PROVENANCE</b></header>
            <article><span>{detail.creator} · {formatDate(detail.published_at)}</span><strong>{detail.content_title}</strong><div>{detail.content_url && <a href={detail.content_url} rel="noreferrer" target="_blank">外部来源 ↗</a>}<button onClick={() => onOpenUnit(detail.unit_id)} type="button">核查完整证据单元 →</button></div></article>
            <div className="verdict-node-impact"><span>影响节点</span>{detail.nodes.length > 0 ? detail.nodes.map((node) => <p key={node.id}><b>#{node.id} · {node.title}</b><em>{node.relation} / {node.status}</em></p>) : <p><b>未归并到长期节点</b><em>该判断仍保留在单元层</em></p>}</div>
          </section>
        </section>
      </div>
      <footer className="verdict-provenance"><span>提取 {detail.extractor_version}</span><span>评分 {detail.scorer_version}</span><b>SCORED WITHOUT LLM</b></footer>
    </article>
  )
}

function DueDossier({ item, onOpenUnit }: { item: DueVerification; onOpenUnit: (unitId: number) => void }) {
  const asset = asText(item.payload.asset_text) ?? asText(item.payload.asset_symbol)
  return (
    <article className="verification-dossier due-dossier outcome-due">
      <header className="verdict-record-lead">
        <div className="verdict-record-id"><span>UPCOMING / UNIT {String(item.unit_id).padStart(3, '0')}</span><b>FROZEN / L2</b></div>
        <section className="verdict-record-result"><strong aria-hidden="true">·</strong><p><span>当前状态</span><b>等待执行</b></p></section>
        <div className="verdict-record-meta"><span><small>发布</small><b>{formatDate(item.published_at)}</b></span><span><small>执行日期</small><b>{item.horizon_label}</b></span><span><small>参考价格</small><b>{item.ref_price_at_publish ?? '未记录'}</b></span></div>
      </header>
      <div className="verdict-workspace">
        <section className="verdict-primary-pane">
          <section className="verdict-quote"><span>原始判断 / VERBATIM</span><blockquote>{item.quote}</blockquote><footer><p>{item.creator} · {item.content_title}</p><b>判据已冻结</b></footer></section>
          <FrozenContract payload={item.payload} />
        </section>
        <section className="verdict-evidence-pane">
          <section className="due-state-card"><span>NEXT EXECUTION</span><time>{formatDate(item.horizon_label)}</time><strong>结果尚未发生</strong><p>执行日期到达之前，系统只展示发布参考和冻结合同，不用正在变化的价格提前解释结论。</p><div><span><small>参考标的</small><b>{asset ?? '未规范化'}</b></span><span><small>发布参考</small><b>{item.ref_price_at_publish ?? '未记录'}</b></span></div></section>
          <section className="due-protocol"><header><p>执行协议</p><b>READ ONLY</b></header><ol><li><i>01</i><span><b>发布时冻结</b><small>原话、标的、期限和成功定义已经落库</small></span></li><li><i>02</i><span><b>等待到期</b><small>不调整规则，也不人工选择有利时点</small></span></li><li><i>03</i><span><b>机械写入</b><small>读取价格证据，执行评分器并保留结果</small></span></li></ol></section>
          <section className="verdict-source due-source"><header><div><p>证据入口</p><span>查看逐字上下文与完整结构化单元</span></div><b>L1 / EVIDENCE</b></header><button onClick={() => onOpenUnit(item.unit_id)} type="button">核查完整证据单元 →</button></section>
        </section>
      </div>
      <footer className="verdict-provenance"><span>执行日期 {item.horizon_label}</span><span>发布时冻结</span><b>WAITING WITHOUT REVISION</b></footer>
    </article>
  )
}

export function VerificationReader({ dueItem, onCloseUnit, onOpenUnit, scoreId, unitOpen }: {
  dueItem: DueVerification | null
  onCloseUnit: () => void
  onOpenUnit: (unitId: number) => void
  scoreId: number | null
  unitOpen: number | null
}) {
  return (
    <>
      {scoreId !== null && <VerificationDossier onOpenUnit={onOpenUnit} scoreId={scoreId} />}
      {scoreId === null && dueItem && <DueDossier item={dueItem} onOpenUnit={onOpenUnit} />}
      {scoreId === null && !dueItem && <div className="verification-dossier-error"><span>UPCOMING RECORD</span><strong>正在等待待执行档案</strong><p>队列载入后会恢复冻结判据和执行日期。</p></div>}
      {unitOpen !== null && <EvidenceDossier backLabel="返回判定档案" onClose={onCloseUnit} parentLabel="VERDICT" parentTitle={scoreId === null ? dueItem?.horizon_label ?? '' : `#${scoreId}`} unitId={unitOpen} />}
    </>
  )
}

export default VerificationDossier
