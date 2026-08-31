import { useEffect, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import { asRecord, asText, claimHeadline, countdown, formatDate, outcomeLabels, outcomeMarks } from './format'

type DueItem = {
  unit_id: number
  quote: string
  payload: Record<string, unknown>
  creator: string
  horizon_label: string
}

type ScoreItem = {
  id: number
  unit_id: number
  quote: string
  payload: Record<string, unknown>
  creator: string
  outcome: string
  horizon_label: string
  eval_ts: string
}

type Summary = {
  overview: { due: number; completed: number; unavailable: number; review: number }
  nearest_due: DueItem[]
}

type LoadState = 'loading' | 'loaded' | 'error'

function assetOf(payload: Record<string, unknown>) {
  return asText(payload.asset_symbol)
}

/** 判据一句。列表要能扫，所以截断；完整判据在标的档案里，那里不许截。 */
function spec(payload: Record<string, unknown>) {
  const text = asText(asRecord(payload.scoring_spec)?.success_def)
  return text ? (text.length > 52 ? `${text.slice(0, 52)}…` : text) : null
}

/**
 * 没选标的时的工作台首屏：跨标的的到期日程与最近裁决。
 *
 * 这两块本来散在验证中心，但"接下来一周全库要交卷什么"其实是每天第一眼要看的东西；
 * 放在这里，点一条就落到对应标的上。数据全部来自已有端点，没有新增后端。
 */
function DeskOverview({ onOpenAsset }: { onOpenAsset: (asset: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scores, setScores] = useState<ScoreItem[]>([])
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    Promise.all([
      apiJson<Summary>('/knowledge/verification-summary?days=21', { signal: controller.signal }),
      apiJson<ScoreItem[]>('/knowledge/recent-scores?days=21&limit=40', { signal: controller.signal }),
    ])
      .then(([nextSummary, nextScores]) => {
        setSummary(nextSummary)
        setScores(Array.isArray(nextScores) ? nextScores : [])
        setState('loaded')
      })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [])

  // 端点没有运行时校验，这里按"字段可能不在"写——首屏崩掉比少一块数字糟得多。
  const overview = summary?.overview
  const due = Array.isArray(summary?.nearest_due) ? summary.nearest_due : []

  return (
    <div className="asset-desk-home">
      <header>
        <div>
          <span>ASSET DESK</span>
          <h1>先看还有什么没兑现</h1>
          <p>左边选一个标的读它的全部证据；这里是跨标的的到期日程与最近裁决。</p>
        </div>
        {overview && (
          <dl>
            <div><dt>21 天内到期</dt><dd>{overview.due ?? '—'}</dd></div>
            <div><dt>近期已判定</dt><dd>{overview.completed ?? '—'}</dd></div>
            <div><dt>条件待观察</dt><dd>{overview.review ?? '—'}</dd></div>
            <div><dt>不可机械验</dt><dd>{overview.unavailable ?? '—'}</dd></div>
          </dl>
        )}
      </header>

      <div className="asset-desk-columns">
        <section aria-label="接下来要交卷">
          <header><p>接下来要交卷</p><span>判据早已冻结，到期只做机械执行</span></header>
          {state === 'loading' && <div className="asset-desk-skeleton">{[0, 1, 2, 3].map((k) => <i key={k} />)}</div>}
          {state === 'error' && <p className="asset-empty">验证队列暂时不可用。</p>}
          {state === 'loaded' && due.length === 0 && (
            <p className="asset-empty">未来 21 天内没有到期时点。判据仍在冻结中，等阶梯日到来。</p>
          )}
          <ol>
            {due.map((item) => {
              const asset = assetOf(item.payload)
              return (
                <li key={`${item.unit_id}-${item.horizon_label}`}>
                  <button
                    disabled={!asset}
                    onClick={() => asset && onOpenAsset(asset)}
                    type="button"
                  >
                    <time>{formatDate(item.horizon_label)}</time>
                    <em>{countdown(item.horizon_label)}</em>
                    <b>{asset ?? '未标定标的'}</b>
                    <strong>{claimHeadline(item.payload) || item.quote}</strong>
                    <i>{spec(item.payload) ?? item.creator}</i>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>

        <section aria-label="最近裁决">
          <header><p>最近裁决</p><span>市场刚刚给出的结果</span></header>
          {state === 'loading' && <div className="asset-desk-skeleton">{[0, 1, 2, 3].map((k) => <i key={k} />)}</div>}
          {state === 'loaded' && scores.length === 0 && <p className="asset-empty">最近 21 天没有新的判定。</p>}
          <ol>
            {scores.map((item) => {
              const asset = assetOf(item.payload)
              return (
                <li key={item.id}>
                  <a href={`#/verification?score=${item.id}`}>
                    <span className={`asset-outcome outcome-${item.outcome}`} title={outcomeLabels[item.outcome]}>
                      {outcomeMarks[item.outcome] ?? '·'}
                    </span>
                    <time>{formatDate(item.horizon_label)}</time>
                    <b>{asset ?? '—'}</b>
                    <strong>{item.quote}</strong>
                    <i>{item.creator}</i>
                  </a>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}

export default DeskOverview
