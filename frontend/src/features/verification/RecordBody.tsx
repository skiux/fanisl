import { useEffect, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import {
  claimClassLabels, gradeText, labelOf, nodeStatusLabels, outcomeLabels, outcomeMarks,
  realizedLabels, scoringMethodLabels, stanceLabels,
} from '../../shared/domain/labels'
import { asRecord, asText, countdown, formatDate } from '../asset/format'
import RecordChart from './RecordChart'
import { dayLabel, formatRealized, isScored, recordKey, type QueueItem } from './records'
import type { VerificationDetail } from './types'

// 实测字段的显示顺序；ladder 与到期日重复、note 单独成句，都不进数字栏
const REALIZED_ORDER = ['ref', 'eval_close', 'asset_ret', 'bench_ret', 'excess_ret', 'relative_ret', 'max_dd', 'high', 'low', 'target', 'cond_date', 'condition']

type Loaded = { scoreId: number; detail: VerificationDetail | null }

function shortDay(value: string) {
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`
}

/** 同一条判断的评分阶梯：已判定的带结果，列表里有的可以点过去，还没排进列表的只列日期 */
function Ladder({ current, dates, items, onSelect }: {
  current: QueueItem
  dates: string[]
  items: QueueItem[]
  onSelect: (item: QueueItem) => void
}) {
  return (
    <nav aria-label="评分时点" className="verify-ladder">
      {dates.map((date) => {
        const item = items.find((entry) => entry.horizon_label.slice(0, 10) === date)
        if (!item) return <span key={date}><i aria-hidden="true">·</i>{shortDay(date)} 未到期</span>
        const scored = isScored(item)
        const label = scored ? outcomeLabels[item.outcome] : countdown(date)
        return (
          <button
            aria-current={recordKey(item) === recordKey(current) ? 'true' : undefined}
            className={scored ? `outcome-${item.outcome}` : 'outcome-due'}
            key={date}
            onClick={() => onSelect(item)}
            type="button"
          >
            <i aria-hidden="true">{scored ? outcomeMarks[item.outcome] : '·'}</i>{shortDay(date)} {label}
          </button>
        )
      })}
    </nav>
  )
}

/** 记录浮层的主体：判定标准、价格与实测、来源。原话在浮层顶部，这里不重复 */
function RecordBody({ item, onOpenUnit, onSelect, unitItems }: {
  item: QueueItem
  onOpenUnit: (unitId: number) => void
  onSelect: (item: QueueItem) => void
  /** 同一单元在四个分类里的全部时点 */
  unitItems: QueueItem[]
}) {
  const scoreId = isScored(item) ? item.score_id : null
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  // 列表行里没有的只有来源链接、定位、版本与关联节点，读不到也不影响主体
  useEffect(() => {
    if (scoreId === null) return
    const controller = new AbortController()
    apiJson<VerificationDetail>(`/knowledge/verifications/${scoreId}`, { signal: controller.signal })
      .then((detail) => setLoaded({ scoreId, detail }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ scoreId, detail: null }) })
    return () => controller.abort()
  }, [scoreId])

  const detail = scoreId !== null && loaded?.scoreId === scoreId ? loaded.detail : null
  const { payload } = item
  const scoring = asRecord(payload.scoring_spec)
  const symbol = asText(payload.asset_symbol)
  const assetText = asText(payload.asset_text)
  const condition = asText(payload.condition_text)
  const successDef = asText(scoring?.success_def)
  const horizon = item.horizon_label.slice(0, 10)
  const outcome = isScored(item) ? item.outcome : null
  const realized = isScored(item) ? item.realized : null
  const realizedNote = asText(realized?.note)
  const numbers = outcome
    ? REALIZED_ORDER.flatMap((key) => {
      const value = formatRealized(key, realized?.[key])
      return value === null ? [] : [{ key, label: realizedLabels[key] ?? key, value }]
    })
    : [{ key: 'ref', label: realizedLabels.ref, value: formatRealized('ref', item.ref_price_at_publish) ?? '未记录' }]
  const ladderDates = [...new Set([
    ...(Array.isArray(scoring?.eval_ladder) ? scoring.eval_ladder : [])
      .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
      .map((value) => value.slice(0, 10)),
    ...unitItems.map((entry) => entry.horizon_label.slice(0, 10)),
  ])].sort()
  // 即将到期的不画价格：结果还没发生，不拿正在变的行情提前解释
  const showChart = isScored(item) && symbol !== null && payload.priceable !== false
    && item.outcome !== 'unpriceable' && item.outcome !== 'condition_unverifiable'
  const nodes = Array.isArray(detail?.nodes) ? detail.nodes : []
  const extraFacts = [
    { label: '判断类型', value: labelOf(claimClassLabels, payload.claim_class) },
    { label: '可验证性', value: gradeText(payload.verifiability) },
    { label: '承诺度', value: labelOf(stanceLabels, payload.stance_strength) },
    { label: '评分方法', value: labelOf(scoringMethodLabels, scoring?.method) },
    { label: '比较基准', value: asText(scoring?.benchmark) },
    { label: '标的说明', value: assetText && assetText !== symbol ? assetText : null },
    { label: '条件能否机械观察', value: condition ? (payload.condition_observable ? '能' : '不能') : null },
    { label: '发布', value: formatDate(item.published_at, true) },
    { label: '判定', value: isScored(item) ? formatDate(item.eval_ts, true) : null },
    { label: '版本', value: detail ? `提取 ${detail.extractor_version} · 评分 ${detail.scorer_version}` : null },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry.value))

  return (
    <div className={`verify-body${showChart ? ' has-chart' : ''}`}>
      {ladderDates.length > 1
        ? <Ladder current={item} dates={ladderDates} items={unitItems} onSelect={onSelect} />
        : (
          <p className={`verify-verdict outcome-${outcome ?? 'due'}`}>
            <b>{outcome ? outcomeLabels[outcome] : countdown(horizon)}</b>
            <span>{dayLabel(horizon)}{outcome ? ' 到期' : ''}</span>
          </p>
        )}

      <div className="verify-body-main">
        <div className="verify-body-text">
          <h4>判定标准</h4>
          <p>{successDef ?? '提取时没有写成功定义'}</p>
          {condition && (
            <>
              <h4>前置条件</h4>
              <p>{condition}</p>
            </>
          )}
          {realizedNote && <p className="verify-body-note">{realizedNote}</p>}
          <dl className="verify-numbers">
            {numbers.map((entry) => <div key={entry.key}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}
          </dl>
        </div>
        {showChart && symbol && outcome && (
          <RecordChart
            evalTs={isScored(item) ? item.eval_ts : null}
            horizon={horizon}
            magnitude={payload.magnitude}
            outcome={outcome}
            publishedAt={item.published_at}
            refPrice={item.ref_price_at_publish}
            symbol={symbol}
          />
        )}
      </div>

      <footer className="verify-body-foot">
        <p>
          {detail?.content_url
            ? <a href={detail.content_url} rel="noreferrer" target="_blank">{item.content_title} ↗</a>
            : <span>{item.content_title}</span>}
          {detail?.locator && <span>{detail.locator}</span>}
        </p>
        <button onClick={() => onOpenUnit(item.unit_id)} type="button">证据单元 →</button>
      </footer>

      <details className="verify-body-more">
        <summary>更多判据信息</summary>
        <dl>
          {extraFacts.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}
          {nodes.length > 0 && (
            <div>
              <dt>关联节点</dt>
              <dd>
                {nodes.map((node) => (
                  <a href={`#/knowledge?node=${node.id}`} key={node.id}>
                    {node.title} <small>{labelOf(nodeStatusLabels, node.status)}</small>
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}

export default RecordBody
