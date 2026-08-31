import { useEffect, useMemo, useRef, useState } from 'react'
import PriceEvidence from './PriceEvidence'
import {
  asNumber, asRecord, asText, count, countdown, directionLabels, formatDate,
  industryLabel, kindLabels, outcomeLabels, outcomeMarks, pct, rateDisplay, ratio,
  sessionLabels, sideLabels, signedPct, stanceLabels, statusLabels, tradeOutcomeLabels,
  tradeStatusLabels, usd, verifiabilityLabels,
} from './format'
import type { AssetDossierData, AssetEvent, OpenClaim, SettledClaim } from './types'

function unitHref(unitId: number) {
  return `#/knowledge?unit=${unitId}&view=evidence`
}

function OutcomeBar({ hits, partials, misses, unresolved }: {
  hits: number
  partials: number
  misses: number
  unresolved: number
}) {
  const total = hits + partials + misses + unresolved
  if (total === 0) return null
  const parts = [
    { key: 'hit', n: hits, label: '命中' },
    { key: 'partial', n: partials, label: '部分' },
    { key: 'miss', n: misses, label: '未中' },
    { key: 'unresolved', n: unresolved, label: '未决' },
  ].filter((part) => part.n > 0)
  return (
    <div className="asset-outcome-bar" aria-hidden="true">
      {parts.map((part) => (
        <i data-part={part.key} key={part.key} style={{ flexGrow: part.n }} title={`${part.label} ${part.n}`} />
      ))}
    </div>
  )
}

function Record({ dossier }: { dossier: AssetDossierData }) {
  const summary = dossier.summary
  if (!summary || summary.scored === 0) {
    return (
      <section className="asset-record asset-record-empty" aria-label="战绩">
        <header><div><p>战绩</p><span>市场对这个标的的裁决</span></div></header>
        <p className="asset-empty">
          还没有到期的判定，因此这里不显示 0%——没样本和全错是两回事。
          {summary && summary.open_claims > 0
            ? `库里有 ${summary.open_claims} 条判断在等到期——最近的一条见下方「未到期判断」。`
            : '要么判断都还没到期，要么这个标的的判断都是不可机械评的等级。'}
        </p>
      </section>
    )
  }
  const rate = rateDisplay(summary)
  return (
    <section className="asset-record" aria-label="战绩">
      <header><div><p>战绩</p><span>命中率 =（命中 + 0.5×部分）÷ 已判定；条件类与不可评类不进分母</span></div></header>
      <div className="asset-record-headline" data-small={rate.small ? 'true' : undefined}>
        <strong>{rate.text}</strong>
        <span>
          n = {summary.scored}
          {rate.isRate ? '' : ' · 样本太小，不折算成百分比'}
        </span>
        <p>
          命中 {summary.hits} · 部分 {summary.partials} · 未中 {summary.misses}
          {summary.unresolved > 0 ? ` · 未决 ${summary.unresolved}（不进分母）` : ''}
        </p>
        <OutcomeBar
          hits={summary.hits}
          misses={summary.misses}
          partials={summary.partials}
          unresolved={summary.unresolved}
        />
      </div>
      <ul className="asset-record-creators">
        {dossier.by_creator.map((row) => {
          const creatorRate = rateDisplay(row)
          return (
          <li key={row.creator_id} data-small={creatorRate.small ? 'true' : undefined}>
            <b>{row.creator}</b>
            <em>{creatorRate.text}</em>
            <span>{row.scored === 0 ? `${row.claims} 条判断待到期` : `n = ${row.scored}`}</span>
            <i>{row.units} 条单元 · 最近 {formatDate(row.last_seen)}</i>
            <OutcomeBar hits={row.hits} misses={row.misses} partials={row.partials} unresolved={0} />
          </li>
          )
        })}
      </ul>
    </section>
  )
}

function ClaimFacts({ payload }: { payload: Record<string, unknown> }) {
  const magnitude = asRecord(payload.magnitude)
  const facts: Array<[string, string]> = []
  const direction = asText(payload.direction)
  if (direction) facts.push(['方向', directionLabels[direction] ?? direction])
  if (magnitude) {
    const parts = Object.entries(magnitude)
      .flatMap(([key, value]) => {
        const number = asNumber(value)
        return number === null ? [] : [`${key} ${number}`]
      })
    if (parts.length) facts.push(['目标', parts.join(' / ')])
  }
  const stance = asText(payload.stance_strength)
  if (stance) facts.push(['承诺度', stanceLabels[stance] ?? stance])
  const grade = asText(payload.verifiability)
  if (grade) facts.push(['可验证性', `${grade} · ${verifiabilityLabels[grade] ?? ''}`])
  const condition = asText(payload.condition_text)
  if (condition) facts.push(['前置条件', condition])
  if (facts.length === 0) return null
  return (
    <dl className="asset-claim-facts">
      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

const OPEN_GROUPS_SHOWN = 6      // 默认展开最近的几个到期日
const SETTLED_SHOWN = 20         // 已判定默认列出多少条
const NODES_SHOWN = 12           // 长期知识默认列出多少条

function OpenClaims({ items }: { items: OpenClaim[] }) {
  const [expanded, setExpanded] = useState(false)
  const groups = useMemo(() => {
    const map = new Map<string, OpenClaim[]>()
    items.forEach((item) => map.set(item.horizon_label, [...(map.get(item.horizon_label) ?? []), item]))
    return [...map.entries()]
  }, [items])
  // XAUUSD 实测 32 个未到期时点，全展开的话这一节就有一万多像素高——先给最近的几个到期日，
  // 那才是"接下来要交卷的"；其余按需展开。
  const visible = expanded ? groups : groups.slice(0, OPEN_GROUPS_SHOWN)
  const hidden = items.length - visible.reduce((sum, [, group]) => sum + group.length, 0)

  return (
    <section className="asset-open" aria-label="未到期判断">
      <header>
        <div><p>未到期判断</p><span>判据在提取当天就冻结了，到期只做机械执行——这里是还没交卷的那些</span></div>
        <b>{items.length} 个时点</b>
      </header>
      {items.length === 0 && (
        <p className="asset-empty">
          没有等待到期的判断。可能是判断都已判定，也可能这个标的的判断都是 D 级（不可机械评）。
        </p>
      )}
      {visible.map(([horizon, group]) => (
        <article className="asset-open-group" key={horizon}>
          <header><time>{formatDate(horizon, true)}</time><span>{countdown(horizon)}</span><i>{group.length} 条</i></header>
          {group.map((item) => {
            const spec = asRecord(item.payload.scoring_spec)
            const successDef = spec ? asText(spec.success_def) : null
            return (
              <a className="asset-open-item" href={unitHref(item.unit_id)} key={`${item.unit_id}-${horizon}`}>
                <span className="asset-open-meta">
                  <b>{item.creator}</b>
                  <i>{formatDate(item.published_at)} 发布</i>
                  {item.ref_price_at_publish !== null && <i>发布参考价 {item.ref_price_at_publish}</i>}
                </span>
                <blockquote>{item.quote}</blockquote>
                <ClaimFacts payload={item.payload} />
                {successDef && <p className="asset-open-spec"><em>判据</em>{successDef}</p>}
                <span className="asset-open-source">{item.content_title}<b aria-hidden="true">↗</b></span>
              </a>
            )
          })}
        </article>
      ))}
      {hidden > 0 && (
        <button className="asset-more" onClick={() => setExpanded(true)} type="button">
          还有 {hidden} 个时点、{groups.length - OPEN_GROUPS_SHOWN} 个到期日 · 展开全部
        </button>
      )}
    </section>
  )
}

function Settled({ items }: { items: SettledClaim[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, SETTLED_SHOWN)
  return (
    <section className="asset-settled" aria-label="已判定记录">
      <header>
        <div><p>已判定</p><span>市场对这个标的的裁决流，按判定时点倒序</span></div>
        <b>{items.length} 条</b>
      </header>
      {items.length === 0 && <p className="asset-empty">还没有到期的判定。判据已冻结，等阶梯日到来。</p>}
      <ol>
        {visible.map((item) => (
          <li key={item.score_id}>
            <a href={`#/verification?score=${item.score_id}`}>
              <span className={`asset-outcome outcome-${item.outcome}`} title={outcomeLabels[item.outcome]}>
                {outcomeMarks[item.outcome]}
              </span>
              <time>{formatDate(item.horizon_label, true)}</time>
              <strong>{item.quote}</strong>
              <em>{item.creator}</em>
              <b aria-hidden="true">↗</b>
            </a>
          </li>
        ))}
      </ol>
      {items.length > visible.length && (
        <button className="asset-more" onClick={() => setExpanded(true)} type="button">
          展开全部 {items.length} 条
        </button>
      )}
    </section>
  )
}

function Disagreements({ dossier }: { dossier: AssetDossierData }) {
  const { relations, evolution } = dossier.disagreements
  if (relations.length === 0 && evolution.length === 0) {
    return (
      <section className="asset-tension" aria-label="分歧与改口">
        <header><div><p>分歧与改口</p><span>对立的命题，以及作者自己改过的口</span></div></header>
        <p className="asset-empty">
          这个标的上还没有人工确认的对立/互补关系，也没有 supersedes 或 contradicts 的提及。
          关系边由归并时人工判定，全库当前只有少量——不是页面出错。
        </p>
      </section>
    )
  }
  return (
    <section className="asset-tension" aria-label="分歧与改口">
      <header><div><p>分歧与改口</p><span>对立的命题，以及作者自己改过的口</span></div></header>
      {relations.length > 0 && (
        <div className="asset-tension-relations">
          {relations.map((relation) => (
            <article key={relation.id} data-relation={relation.relation}>
              <span>{relation.relation === 'conflicts' ? '对立' : '关联'}</span>
              <div>
                <a href={`#/knowledge?node=${relation.a_node}`}>
                  <b>{relation.a_title}</b><i>{statusLabels[relation.a_status] ?? relation.a_status}</i>
                </a>
                <a href={`#/knowledge?node=${relation.b_node}`}>
                  <b>{relation.b_title}</b><i>{statusLabels[relation.b_status] ?? relation.b_status}</i>
                </a>
              </div>
              <p>{relation.note}</p>
            </article>
          ))}
        </div>
      )}
      {evolution.length > 0 && (
        <ol className="asset-tension-evolution">
          {evolution.map((item) => (
            <li key={item.unit_id}>
              <a href={unitHref(item.unit_id)}>
                <span>{item.relation === 'supersedes' ? '作者改口' : '被反驳'}</span>
                <time>{formatDate(item.published_at, true)}</time>
                <b>{item.node_title}</b>
                <blockquote>{item.quote}</blockquote>
                <em>{item.creator} · {item.content_title}</em>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Coverage({ dossier }: { dossier: AssetDossierData }) {
  const { coverage, identity } = dossier
  const hasCompany = coverage.has_company !== false
  const bars = coverage.bars_window
  const rows: Array<{ key: string; label: string; ok: boolean; detail: string }> = [
    {
      key: 'bars',
      label: '日线',
      ok: Boolean(bars),
      detail: bars
        ? `${bars.n} 根 · ${bars.first} → ${bars.last}${coverage.bars_note ? ` · ${coverage.bars_note}` : ''}`
        : coverage.bars
          ? '已登记日线源，但库里还没有这个标的的日线'
          : identity.note || '没有可用的日线源，因此这个标的的判断无法机械评分',
    },
    {
      key: 'metrics',
      label: '全维度指标',
      ok: Boolean(coverage.metrics),
      detail: coverage.metrics
        ? `${coverage.metrics} · 15 分钟采集`
        : '未采集。41 个 metric 的高频采集当前只覆盖 5 个加密对',
    },
    {
      key: 'news',
      label: '重要动态',
      ok: Boolean(coverage.news),
      detail: coverage.news
        ? `${coverage.news.n} 条 · 最近一条 ${formatDate(coverage.news.latest ?? coverage.news.fetched_at)}`
        : hasCompany
          ? '已接入（Finnhub 按标的新闻，天更），这段时间没有抓到这个标的的新闻'
          : '指数/贵金属/商品/利率没有按标的的新闻源；关键词兜底实测相关性太差，不做',
    },
    {
      key: 'profile',
      label: '公司资料',
      ok: Boolean(dossier.profile),
      detail: dossier.profile
        ? `${[...new Set(Object.values(dossier.profile.sources ?? {}))].join(' · ') || '未知来源'}`
          + ` · 抓取于 ${formatDate(dossier.profile.fetched_at)}`
        : hasCompany
          ? '已接入（Polygon 参考数据 + Finnhub 画像与指标，周更），还没轮到这个标的'
          : '这个标的没有"公司"这回事，两个源都不收录',
    },
    {
      key: 'route',
      label: '行情路由',
      ok: Boolean(coverage.instrument),
      detail: coverage.instrument ? `${coverage.instrument} · 可取实时快照与交易` : '未登记路由，只能读日线',
    },
  ]
  return (
    <section className="asset-coverage" aria-label="数据覆盖">
      <header><div><p>数据覆盖</p><span>这一页有哪些数据、缺哪些——缺的直接写明原因，不用别的凑</span></div></header>
      <ul>
        {rows.map((row) => (
          <li key={row.key} data-ok={row.ok ? 'true' : 'false'}>
            <b>{row.label}</b>
            <i aria-hidden="true" />
            <span>{row.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export type DossierView =
  | 'open' | 'record' | 'news' | 'profile' | 'tension' | 'knowledge' | 'trades' | 'coverage'

export const DOSSIER_VIEWS: DossierView[] = [
  'open', 'record', 'news', 'profile', 'tension', 'knowledge', 'trades', 'coverage',
]

const viewLabels: Record<DossierView, string> = {
  open: '未到期', record: '战绩', news: '动态', profile: '资料',
  tension: '分歧', knowledge: '知识', trades: '交易', coverage: '覆盖',
}

const SPLIT_KEY = 'fanisl.asset.split'
const SPLIT_MIN = .22
const SPLIT_MAX = .74

function readSplit(): number {
  try {
    const raw = Number(window.localStorage.getItem(SPLIT_KEY))
    return Number.isFinite(raw) && raw >= SPLIT_MIN && raw <= SPLIT_MAX ? raw : .46
  } catch {
    return .46   // 隐私窗口/禁用站点数据时读写都会抛，用默认值照常工作
  }
}

/** 图与明细之间的分隔条：拖动改比例，双击复位，聚焦后上下键微调。 */
function Splitter({ ratio, onChange, containerRef }: {
  ratio: number
  onChange: (next: number) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const clamp = (value: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      onChange(clamp((moveEvent.clientY - box.top) / box.height))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return (
    <div
      aria-label="调整图与明细的比例"
      aria-orientation="horizontal"
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      className="asset-splitter"
      onDoubleClick={() => onChange(.46)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); onChange(clamp(ratio - .04)) }
        if (event.key === 'ArrowDown') { event.preventDefault(); onChange(clamp(ratio + .04)) }
      }}
      onPointerDown={drag}
      role="separator"
      tabIndex={0}
    ><i /></div>
  )
}

function Knowledge({ dossier, onOpenAsset }: {
  dossier: AssetDossierData
  onOpenAsset: (asset: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const nodes = expanded ? dossier.nodes : dossier.nodes.slice(0, NODES_SHOWN)
  return (
    <>
      <section className="asset-nodes" aria-label="相关长期知识">
        <header>
          <div><p>长期知识</p><span>挂着这个标的的规范节点——可复用的那一层</span></div>
          <b>{dossier.nodes.length} 条</b>
        </header>
        {dossier.nodes.length === 0 && (
          <p className="asset-empty">还没有归并到节点。单元先进证据层，归并是人工判定的下一步。</p>
        )}
        <div>
          {nodes.map((node) => (
            <a href={`#/knowledge?node=${node.id}`} key={node.id}>
              <span>{kindLabels[node.kind] ?? node.kind} · {statusLabels[node.status] ?? node.status}</span>
              <strong>{node.title}</strong>
              <p>{node.canonical}</p>
              <i>{node.n_attest} 次提及 · {node.n_creators} 位信源</i>
            </a>
          ))}
        </div>
        {dossier.nodes.length > nodes.length && (
          <button className="asset-more" onClick={() => setExpanded(true)} type="button">
            展开全部 {dossier.nodes.length} 条
          </button>
        )}
      </section>
      {dossier.related_assets.length > 0 && (
        <section className="asset-related" aria-label="相关标的">
          <header><div><p>相关标的</p><span>同一条单元里被一起提到的——语料自己说的，不是人工维护的关联表</span></div></header>
          <div>
            {dossier.related_assets.map((item) => (
              <button key={item.asset} onClick={() => onOpenAsset(item.asset)} type="button">
                <b>{item.display ?? item.asset}</b>
                <span>{item.asset}</span>
                <i>共现 {item.co_mentions}</i>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Earnings({ dossier }: { dossier: AssetDossierData }) {
  if (dossier.coverage.has_earnings === false) return null
  const today = new Date().toISOString().slice(0, 10)
  const events = (dossier.events ?? []).filter((event) => event.kind === 'earnings')
  const upcoming = events.filter((event) => event.event_date >= today)
  const past = events.filter((event) => event.event_date < today).slice(-3).reverse()
  const next: AssetEvent | undefined = upcoming[0]

  return (
    <div className="asset-earnings">
      <h3>财报日历</h3>
      {events.length === 0 && (
        <p className="asset-empty">还没有抓到这个标的的财报日程。日历天更，新登记的标的要等下一轮。</p>
      )}
      {next && (
        <div className="asset-earnings-next">
          <b>{formatDate(next.event_date, true)}</b>
          <span>
            {countdown(next.event_date)}
            {next.session && sessionLabels[next.session] ? ` · ${sessionLabels[next.session]}` : ''}
            {next.payload?.fiscal_year && next.payload?.quarter
              ? ` · FY${next.payload.fiscal_year} Q${next.payload.quarter}`
              : ''}
          </span>
          {typeof next.payload?.eps_estimate === 'number' && (
            <i>市场预期 EPS {next.payload.eps_estimate.toFixed(2)}</i>
          )}
        </div>
      )}
      {past.length > 0 && (
        <ul className="asset-earnings-past">
          {past.map((event) => {
            const actual = event.payload?.eps_actual
            const estimate = event.payload?.eps_estimate
            const beat = typeof actual === 'number' && typeof estimate === 'number'
              ? actual - estimate
              : null
            return (
              <li key={event.event_date}>
                <time>{formatDate(event.event_date, true)}</time>
                <span>
                  {typeof actual === 'number' ? `实际 ${actual.toFixed(2)}` : '实际 —'}
                  {typeof estimate === 'number' ? ` · 预期 ${estimate.toFixed(2)}` : ''}
                </span>
                {beat !== null && (
                  <em data-beat={beat >= 0 ? 'true' : 'false'}>
                    {beat >= 0 ? '超预期' : '不及预期'} {beat >= 0 ? '+' : ''}{beat.toFixed(2)}
                  </em>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Trades({ dossier }: { dossier: AssetDossierData }) {
  const trades = dossier.trades ?? []
  return (
    <section className="asset-trades" aria-label="交易记录">
      <header>
        <div><p>交易记录</p><span>评测台在这个标的上开过的仓——评的是 setup 与执行，不是真钱交易所</span></div>
        <b>{trades.length} 笔</b>
      </header>
      {trades.length === 0 && (
        <p className="asset-empty">评测台没有在这个标的上开过仓。多数标的会长期为空——现在进场路径只覆盖少数几个符号。</p>
      )}
      <ol>
        {trades.map((trade) => (
          <li key={trade.id}>
            <span className="asset-trade-side" data-side={trade.side}>{sideLabels[trade.side] ?? trade.side}</span>
            <time>{formatDate(trade.opened_at ?? trade.created_at, true)}</time>
            <b>{trade.account}</b>
            <i>{trade.setup_key ?? '酌情'}</i>
            <em>{tradeStatusLabels[trade.status] ?? trade.status}</em>
            <span className="asset-trade-pnl" data-outcome={trade.outcome ?? undefined}>
              {trade.outcome ? tradeOutcomeLabels[trade.outcome] ?? trade.outcome : '—'}
              {signedPct(trade.pnl_pct) && ` ${signedPct(trade.pnl_pct)}`}
              {typeof trade.realized_r === 'number' && ` · ${trade.realized_r.toFixed(2)}R`}
            </span>
            <u>{trade.symbol}</u>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Profile({ dossier }: { dossier: AssetDossierData }) {
  const profile = dossier.profile
  if (!profile) {
    return (
      <section className="asset-profile" aria-label="公司资料">
        <header><div><p>公司资料</p><span>名称、行业、规模与估值</span></div></header>
        <p className="asset-empty">
          {dossier.coverage.has_company
            ? '还没有抓过这个标的的资料。资料每周刷一轮，新登记的标的要等下一轮。'
            : '这个标的没有"公司"这回事（指数、贵金属、商品、利率都没有），不是我们没接。'}
        </p>
        <Earnings dossier={dossier} />
      </section>
    )
  }
  const m = profile.metrics ?? {}
  const facts: Array<[string, string | null]> = [
    ['行业', industryLabel(profile.industry)],
    ['交易所', profile.exchange],
    ['上市', profile.listed_on ? formatDate(profile.listed_on, true) : null],
    ['雇员', count(profile.employees)],
    ['市值', usd(profile.market_cap) ? `${usd(profile.market_cap)} ${profile.currency ?? 'USD'}` : null],
    ['股本', count(profile.shares_out)],
  ]
  const metrics: Array<[string, string | null]> = [
    ['市盈率 TTM', ratio(m.pe_ttm)],
    ['市销率 TTM', ratio(m.ps_ttm)],
    ['市净率', ratio(m.pb)],
    ['每股收益 TTM', ratio(m.eps_ttm)],
    ['毛利率', pct(m.gross_margin)],
    ['营业利润率', pct(m.operating_margin)],
    ['净利率', pct(m.net_margin)],
    ['营收同比', pct(m.revenue_growth_yoy)],
    ['EPS 同比', pct(m.eps_growth_yoy)],
    ['ROE', pct(m.roe)],
    ['Beta', ratio(m.beta)],
    ['52 周区间', m.low_52w && m.high_52w ? `${ratio(m.low_52w)} – ${ratio(m.high_52w)}` : null],
  ]
  const sources = [...new Set(Object.values(profile.sources ?? {}))].join(' · ')
  return (
    <section className="asset-profile" aria-label="公司资料">
      <header>
        <div><p>{profile.name ?? dossier.identity.id}</p><span>名称、行业、规模与估值</span></div>
        {profile.homepage && (
          <a href={profile.homepage} rel="noopener noreferrer" target="_blank">官网 ↗</a>
        )}
      </header>
      {profile.description && <p className="asset-profile-about">{profile.description}</p>}
      <dl className="asset-profile-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="asset-profile-metrics">
        {metrics.filter(([, value]) => value).map(([label, value]) => (
          <span key={label}><b>{value}</b><i>{label}</i></span>
        ))}
      </div>
      <Earnings dossier={dossier} />
      <footer className="asset-profile-note">
        口径：{sources || '未知来源'} · 抓取于 {formatDate(profile.fetched_at, true)}
        {profile.cik && ` · CIK ${profile.cik}`}
      </footer>
    </section>
  )
}

function News({ dossier }: { dossier: AssetDossierData }) {
  const items = dossier.news ?? []
  const hidden = dossier.coverage.news?.noise ?? 0
  return (
    <section className="asset-news" aria-label="重要动态">
      <header>
        <div>
          <p>重要动态</p>
          <span>按标的的新闻时间线，追加入库、可回溯；盘面流水与榜单已降噪拿掉</span>
        </div>
        <b>{items.length} 条</b>
      </header>
      {items.length === 0 && (
        <p className="asset-empty">
          {dossier.coverage.has_company
            ? '这段时间没有抓到这个标的的新闻。新闻天更，只保留有 ticker 的标的。'
            : '指数、贵金属、商品、利率没有按标的的新闻源。曾实测用关键词检索兜底，'
              + '相关性差到会污染页面（"gold price" 首条返回的是一则加密清算新闻），故不做。'}
        </p>
      )}
      <ol>
        {items.map((item, index) => (
          <li key={item.id ?? `${item.published_at}-${index}`} data-relevance={item.relevance ?? undefined}>
            <a href={item.url ?? undefined} rel="noopener noreferrer" target="_blank">
              <time>{formatDate(item.published_at)}</time>
              <i>
                {item.source ?? item.provider}
                {item.relevance === 'context' && <em>相关背景</em>}
              </i>
              <strong>{item.title}</strong>
              {/* 有中文摘要就用它——这是个中文产品，标题却全是英文 */}
              {item.note ? <p className="asset-news-note">{item.note}</p>
                : item.summary && <p>{item.summary}</p>}
            </a>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <p className="asset-empty">
          另有 {hidden} 条被判为噪音（盘面流水、异动榜单、讲的是别家公司）已隐藏。
          原始记录一条没删，规则改了可以重判。
        </p>
      )}
    </section>
  )
}

/**
 * 标的工作台：常驻报头 + 价格图 + 停靠的证据面板，整体钉在视口里。
 *
 * 形态上借了交易终端那套"图在上、明细在下、标的常驻在侧"的分区，但内容仍是这个产品
 * 自己的东西——图上画的是判定与到期日，不是指标；下面停的是逐字证据，不是订单簿。
 * 之前那版把价格做成七个标签里的一个，结果是"看图"和"看判断"永远只能二选一。
 */
function AssetDossier({ dossier, view, onSelectView, onOpenAsset }: {
  dossier: AssetDossierData
  /** null = 用户没指定分节，落到第一个有内容的那一节。 */
  view: DossierView | null
  onSelectView: (view: DossierView) => void
  onOpenAsset: (asset: string) => void
}) {
  const { identity, summary } = dossier
  // 契约校验已经挡住了缺字段的响应，这里再兜一层：渲染期崩掉是整页白屏，代价比少一块内容大得多。
  const news = dossier.news ?? []
  const events = dossier.events ?? []
  const trades = dossier.trades ?? []
  const hasPrice = Boolean(dossier.coverage.bars_window)
  const showChart = hasPrice && summary !== null
  const panel = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(readSplit)

  const setSplit = (next: number) => {
    setRatio(next)
    try { window.localStorage.setItem(SPLIT_KEY, String(next)) } catch { /* 存不了就只在本次会话生效 */ }
  }

  const identityRate = summary ? rateDisplay(summary) : null
  const counts: Record<DossierView, string | null> = {
    open: summary ? String(summary.open_claims) : null,
    // 标签上的徽章跟正文同一条规则：样本不够就不挂百分比（挂了就是"战绩 100%"那种误导）
    record: identityRate?.isRate ? identityRate.text : null,
    news: news.length ? String(news.length) : null,
    profile: null,
    tension: String(dossier.disagreements.relations.length + dossier.disagreements.evolution.length),
    knowledge: String(dossier.nodes.length),
    trades: trades.length ? String(trades.length) : null,
    coverage: null,
  }
  // 没有"公司"的标的（指数/金属/利率）不摆两个永远空的标签——覆盖那一节会解释为什么。
  const hasCompany = dossier.coverage.has_company !== false
  // 不摆永远空的标签：没有公司就没有资料/动态；评测台没开过仓就没有交易；
  // 库里没有知识单元就没有未到期/战绩/分歧/知识——但**交易与资料仍可能有**
  // （BZ 实测：0 条知识单元、3 笔交易，早先那版把它整页收成只剩"覆盖"，是错的）。
  const available = DOSSIER_VIEWS.filter((key) => {
    if (key === 'coverage') return true
    if (key === 'trades') return trades.length > 0
    if (key === 'news' || key === 'profile') return hasCompany
    return summary !== null
  })
  // 有内容的分节。用户显式点了某一节就听他的（哪怕空），没指定时才自动落位。
  const filled: Record<DossierView, boolean> = {
    open: (summary?.open_claims ?? 0) > 0,
    record: (summary?.scored ?? 0) > 0 || dossier.settled_claims.length > 0,
    news: news.length > 0,
    profile: dossier.profile !== null,
    tension: dossier.disagreements.relations.length + dossier.disagreements.evolution.length > 0,
    knowledge: dossier.nodes.length > 0,
    trades: trades.length > 0,
    coverage: true,
  }
  const fallback = available.find((key) => filled[key]) ?? available[available.length - 1]
  const active = view && available.includes(view) ? view : fallback

  // 换标的或换分节都从顶部开始读——内部滚动容器不会自己回到顶部。
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0 }, [active, dossier.asset])

  return (
    <div className="asset-workspace">
      <header className="asset-identity">
        <div>
          <span className="asset-identity-class">{identity.class_label ?? '未分类'}</span>
          <h1>{identity.display ?? identity.id}</h1>
          <p className="asset-identity-symbol">
            {identity.id}
            {identity.aliases.length > 0 && <em>也写作 {identity.aliases.join(' · ')}</em>}
          </p>
          {!identity.registered && (
            <p className="asset-identity-warn">该符号出现在语料里但不在登记表内——这是待补的登记缺口。</p>
          )}
        </div>
        {summary && (
          <dl className="asset-identity-scale">
            <div><dt>知识单元</dt><dd>{summary.units}</dd></div>
            <div><dt>未到期</dt><dd>{summary.open_claims}</dd></div>
            <div>
              {/* 值是计数时标签也得跟着换——"命中率 9 中"读不通 */}
              <dt>{identityRate?.isRate ? '命中率' : '判定'}</dt>
              <dd data-small={identityRate?.small ? 'true' : undefined}>
                {summary.scored === 0 ? '—' : identityRate?.text}
                {identityRate?.isRate && <em>n={summary.scored}</em>}
              </dd>
            </div>
            <div><dt>信源</dt><dd>{summary.creators}</dd></div>
          </dl>
        )}
      </header>

      <div
        className="asset-frame"
        ref={frame}
        style={{
          // 没有图时不给它留半屏空白：整块高度让给证据面板。
          gridTemplateRows: showChart
            ? `minmax(0, ${ratio}fr) auto minmax(0, ${1 - ratio}fr)`
            : 'auto auto minmax(0, 1fr)',
        }}
      >
        {showChart ? (
          <div className="asset-chart">
            <PriceEvidence
              events={events}
              note={dossier.coverage.bars_note}
              open={dossier.open_claims}
              settled={dossier.settled_claims}
              symbol={dossier.asset}
            />
          </div>
        ) : (
          <div className="asset-chart-empty">
            <p>没有价格证据图</p>
            <span>
              {dossier.coverage.bars
                ? '已登记日线源，但库里还没有这个标的的日线。'
                : identity.note || '这个标的没有可用的日线源，因此它的判断无法机械评分——只能人工核。'}
            </span>
          </div>
        )}

        {showChart && <Splitter containerRef={frame} onChange={setSplit} ratio={ratio} />}
        {!showChart && <div className="asset-frame-gap" />}

        <div className="asset-panel">
          <nav className="asset-views" aria-label="证据分节">
            {available.map((key) => (
              <button
                aria-current={active === key ? 'true' : undefined}
                aria-label={counts[key] ? `${viewLabels[key]} ${counts[key]}` : viewLabels[key]}
                key={key}
                onClick={() => onSelectView(key)}
                type="button"
              >
                {viewLabels[key]}{counts[key] && <i>{counts[key]}</i>}
              </button>
            ))}
          </nav>
          <div className="asset-sections" ref={panel}>
            {summary === null && active === 'coverage' && (
              <p className="asset-empty asset-empty-page">
                登记表里有这个标的，但库里还没有任何知识单元——没人在已摄取的内容里讲过它。
                它会在下一次提取带出相关判断时自动出现。
              </p>
            )}
            {active === 'open' && <OpenClaims items={dossier.open_claims} />}
            {active === 'record' && (
              <>
                <Record dossier={dossier} />
                <Settled items={dossier.settled_claims} />
              </>
            )}
            {active === 'news' && <News dossier={dossier} />}
            {active === 'profile' && <Profile dossier={dossier} />}
            {active === 'tension' && <Disagreements dossier={dossier} />}
            {active === 'knowledge' && <Knowledge dossier={dossier} onOpenAsset={onOpenAsset} />}
            {active === 'trades' && <Trades dossier={dossier} />}
            {active === 'coverage' && (
              <>
                <Coverage dossier={dossier} />
                {identity.note && <p className="asset-empty">{identity.note}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AssetDossier
