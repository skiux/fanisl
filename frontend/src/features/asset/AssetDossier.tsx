import { useMemo, useState } from 'react'
import PriceEvidence from './PriceEvidence'
import {
  SMALL_SAMPLE, asNumber, asRecord, asText, countdown, directionLabels, formatDate,
  kindLabels, outcomeLabels, outcomeMarks, percent, stanceLabels, statusLabels,
  verifiabilityLabels,
} from './format'
import type { AssetDossierData, OpenClaim, SettledClaim } from './types'

function unitHref(unitId: number) {
  return `#/knowledge?unit=${unitId}&view=evidence`
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
  const small = summary.scored < SMALL_SAMPLE
  return (
    <section className="asset-record" aria-label="战绩">
      <header><div><p>战绩</p><span>命中率 =（命中 + 0.5×部分）÷ 已判定；条件类与不可评类不进分母</span></div></header>
      <div className="asset-record-headline" data-small={small ? 'true' : undefined}>
        <strong>{percent(summary.hit_rate)}</strong>
        <span>n = {summary.scored}{small ? ' · 样本小，仅供跟踪' : ''}</span>
        <p>
          命中 {summary.hits} · 部分 {summary.partials} · 未中 {summary.misses}
          {summary.unresolved > 0 ? ` · 未决 ${summary.unresolved}（不进分母）` : ''}
        </p>
      </div>
      <ul className="asset-record-creators">
        {dossier.by_creator.map((row) => (
          <li key={row.creator_id} data-small={row.scored > 0 && row.scored < SMALL_SAMPLE ? 'true' : undefined}>
            <b>{row.creator}</b>
            <em>{row.scored === 0 ? '未验证' : percent(row.hit_rate)}</em>
            <span>{row.scored === 0 ? `${row.claims} 条判断待到期` : `n = ${row.scored}`}</span>
            <i>{row.units} 条单元 · 最近 {formatDate(row.last_seen)}</i>
          </li>
        ))}
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
        ? `${coverage.news.n} 条 · 最近抓取 ${formatDate(coverage.news.fetched_at)}`
        : '未接入。新闻源当前只覆盖采集 watchlist 的加密对',
    },
    {
      key: 'profile',
      label: '公司资料',
      ok: false,
      detail: '未接入。名称/行业/市值/估值待公司资料源落地',
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

function AssetDossier({ dossier, onOpenAsset }: {
  dossier: AssetDossierData
  onOpenAsset: (asset: string) => void
}) {
  const { identity, summary } = dossier
  const showPrice = Boolean(dossier.coverage.bars_window)

  return (
    <div className="asset-dossier">
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
          {identity.note && <p className="asset-identity-note">{identity.note}</p>}
        </div>
        {summary && (
          <dl className="asset-identity-scale">
            <div><dt>知识单元</dt><dd>{summary.units}</dd></div>
            <div><dt>未到期</dt><dd>{summary.open_claims}</dd></div>
            <div><dt>已判定</dt><dd>{summary.scored}</dd></div>
            <div><dt>信源</dt><dd>{summary.creators}</dd></div>
          </dl>
        )}
      </header>

      {summary === null && (
        <p className="asset-empty asset-empty-page">
          登记表里有这个标的，但库里还没有任何知识单元——没人在已摄取的内容里讲过它。
          它会在下一次提取带出相关判断时自动出现。
        </p>
      )}

      <Coverage dossier={dossier} />

      {summary !== null && (
        <>
          <Record dossier={dossier} />
          <OpenClaims items={dossier.open_claims} />
          {showPrice && (
            <PriceEvidence
              note={dossier.coverage.bars_note}
              open={dossier.open_claims}
              settled={dossier.settled_claims}
              symbol={dossier.asset}
            />
          )}
          <Settled items={dossier.settled_claims} />
          <Disagreements dossier={dossier} />

          <section className="asset-nodes" aria-label="相关长期知识">
            <header>
              <div><p>长期知识</p><span>挂着这个标的的规范节点——可复用的那一层</span></div>
              <b>{dossier.nodes.length} 条</b>
            </header>
            {dossier.nodes.length === 0 && (
              <p className="asset-empty">还没有归并到节点。单元先进证据层，归并是人工判定的下一步。</p>
            )}
            <div>
              {dossier.nodes.map((node) => (
                <a href={`#/knowledge?node=${node.id}`} key={node.id}>
                  <span>{kindLabels[node.kind] ?? node.kind} · {statusLabels[node.status] ?? node.status}</span>
                  <strong>{node.title}</strong>
                  <p>{node.canonical}</p>
                  <i>{node.n_attest} 次提及 · {node.n_creators} 位信源</i>
                </a>
              ))}
            </div>
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
      )}
    </div>
  )
}

export default AssetDossier
