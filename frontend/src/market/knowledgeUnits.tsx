import { navigate } from '../lib/router'
import { Quote, ScoreBadge } from './ui'

// 知识单元的共享文法（DESIGN.md §9）：结论—口径—证据三行，跨页面同构。
// 本文件是唯一实现处：时间流阅读页 / 跨内容浏览 / 单元详情 / 今日流共用。

export const KIND_LABEL: Record<string, string> = { claim: '判断', method: '方法', concept: '认知' }

export const GRADE_CLS: Record<string, string> = {
  A: 'text-verdict-hit', B: 'text-zinc-500', C: 'text-verdict-partial', D: 'text-zinc-400',
}

const DIR: Record<string, string> = { up: '↑', down: '↓', flat: '→', range: '↔', vol_up: 'σ↑', vol_down: 'σ↓' }

export function claimHeadline(p: any): string {
  const parts = [p.asset_symbol ?? p.asset_text]
  if (p.direction) parts.push(DIR[p.direction] ?? p.direction)
  if (p.magnitude?.target != null) parts.push(`目标 ${p.magnitude.target}`)
  if (p.magnitude?.low != null && p.magnitude?.high != null) parts.push(`${p.magnitude.low} ~ ${p.magnitude.high}`)
  else if (p.magnitude?.low != null) parts.push(`守 ${p.magnitude.low}`)
  else if (p.magnitude?.high != null) parts.push(`压 ${p.magnitude.high}`)
  return parts.join(' ')
}

export function unitHeadline(u: { kind: string; payload: any }): string {
  const p = u.payload ?? {}
  if (u.kind === 'claim') return claimHeadline(p)
  if (u.kind === 'method') return p.name
  return p.stance === 'reject' ? `反对：${p.canonical_statement}` : p.canonical_statement
}

// 口径行（claim）：等级 · 至期限 · 基准 · 措辞
export function ClaimMetaLine({ p, refPrice }: { p: any; refPrice?: number | null }) {
  const deadline = p.scoring_spec?.eval_ladder?.slice(-1)[0]
  return (
    <>
      <span className={`font-mono font-semibold ${GRADE_CLS[p.verifiability] ?? ''}`}>{p.verifiability}</span>
      {deadline && <span> · 至 <span className="font-mono">{deadline}</span></span>}
      {refPrice != null && (
        <span title="发布时点参考价（屏价优先）"> · 基准 <span className="font-mono">{refPrice}</span></span>
      )}
      {p.stance_strength !== 'explicit' && <span> · {p.stance_strength === 'hedged' ? '对冲表述' : '试探表述'}</span>}
    </>
  )
}

// --- 单元块：结论行 → 口径行 → 引文块 → 扩展区 -------------------------------
// context：跨内容浏览/今日流时附来源行（信源 · 日期 · 内容标题）。
export function UnitBlock({ u, onLocator, context = false }: {
  u: any
  onLocator?: () => void
  context?: boolean
}) {
  const p = u.payload ?? {}
  const headline = unitHeadline(u)
  const toDetail = () => navigate(`/knowledge/unit/${u.id}`)
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <button onClick={toDetail}
          className="text-left text-md font-medium leading-snug text-zinc-900 underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-150 hover:decoration-zinc-300">
          {headline}
        </button>
        {u.kind === 'claim' && (u.scores ?? []).map((s: any, i: number) => (
          <button key={i} onClick={toDetail} className="active:translate-y-px">
            <ScoreBadge horizonLabel={s.horizon_label} outcome={s.outcome} evalClose={s.realized?.eval_close} />
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs text-zinc-400">
        {u.kind === 'claim' && <ClaimMetaLine p={p} refPrice={u.ref_price_at_publish} />}
        {u.kind === 'method' && <span>{p.family} · 可测性 {p.testability}{p.summary ? ` · ${p.summary}` : ''}</span>}
        {u.kind === 'concept' && <span>{p.category}{p.regime_qualifier ? ` · ${p.regime_qualifier}` : ''}</span>}
        {context && (
          <span>
            {' '}· {u.creator}
            {u.published_at && <> · {fmtShortDate(u.published_at)}</>}
            {u.content_title && (
              <>
                {' '}·{' '}
                <button onClick={() => navigate(`/knowledge/content/${u.content_id}`)}
                  className="underline decoration-zinc-200 transition-colors duration-150 hover:text-zinc-600 hover:decoration-zinc-400">
                  {u.content_title.length > 24 ? u.content_title.slice(0, 24) + '…' : u.content_title}
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <Quote locator={u.locator} onLocator={onLocator}>{u.quote}</Quote>
      </div>
      {u.kind === 'claim' && p.condition_text && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">前置条件：{p.condition_text}{!p.condition_observable && '（不可机械判定）'}</p>
      )}
      {u.kind === 'method' && (p.rules ?? []).length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-600">
          {p.rules.map((r: string, i: number) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {u.kind === 'claim' && p.scoring_spec?.success_def && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">评分口径：{p.scoring_spec.success_def}</p>
      )}
    </div>
  )
}

export const fmtShortDate = (s: string) => {
  const d = new Date(s)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// --- 评分 realized 明细（scorers.py 落库字段 → 中文标签）---------------------

const REALIZED_LABELS: Record<string, { label: string; pct?: boolean }> = {
  eval_close: { label: '评估价' },
  ref: { label: '基准价' },
  asset_ret: { label: '标的收益', pct: true },
  bench_ret: { label: '基准收益', pct: true },
  max_dd: { label: '最大回撤', pct: true },
  touch_price: { label: '触及价' },
  touch_date: { label: '触及日' },
  cond_date: { label: '条件确认日' },
}

export function realizedText(realized: any): string {
  if (!realized) return ''
  return Object.entries(realized)
    .filter(([k]) => k !== 'ladder')
    .map(([k, v]) => {
      const def = REALIZED_LABELS[k]
      if (!def) return `${k} ${v}`
      if (def.pct && typeof v === 'number') return `${def.label} ${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
      return `${def.label} ${v}`
    })
    .join(' · ')
}

// --- Claim 生命线（DESIGN.md §7.6）：发布 ● → 评估时点 ○/判决色 → 今 --------

const OUTCOME_FILL: Record<string, string> = {
  hit: '#059669', partial: '#d97706', miss: '#f43f5e',
  condition_not_met: '#a1a1aa', condition_unverifiable: '#a1a1aa', unpriceable: '#a1a1aa',
}

export function Lifeline({ published, ladder, scores }: {
  published: string
  ladder: string[]
  scores: { horizon_label: string; outcome: string }[]
}) {
  const W = 640
  const H = 46
  const pad = 8
  const pub = new Date(published).getTime()
  const now = Date.now()
  const dates = ladder.map((d) => new Date(d).getTime())
  const end = Math.max(now, ...dates, pub + 86400000)
  const span = end - pub || 1
  const x = (t: number) => pad + ((t - pub) / span) * (W - pad * 2)
  const byLabel = Object.fromEntries(scores.map((s) => [s.horizon_label, s.outcome]))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="claim 生命线">
      <line x1={pad} y1={16} x2={x(end)} y2={16} stroke="#e4e4e7" strokeWidth={1.2} />
      {/* 已走过的部分实线 */}
      <line x1={pad} y1={16} x2={x(Math.min(now, end))} y2={16} stroke="#a1a1aa" strokeWidth={1.2} />
      {/* 今：细竖线 */}
      {now < end && <line x1={x(now)} y1={8} x2={x(now)} y2={24} stroke="#d4d4d8" strokeWidth={1} />}
      {/* 发布点 */}
      <circle cx={x(pub)} cy={16} r={3.5} fill="#18181b" />
      <text x={x(pub)} y={38} textAnchor="start" fontSize={10} fill="#a1a1aa" fontFamily="Geist Mono">
        {new Date(pub).toISOString().slice(5, 10)} 发布
      </text>
      {/* 评估时点 */}
      {ladder.map((d, i) => {
        const t = new Date(d).getTime()
        const o = byLabel[d]
        const cx = x(t)
        return (
          <g key={i}>
            {o
              ? <circle cx={cx} cy={16} r={4} fill={OUTCOME_FILL[o] ?? '#a1a1aa'} />
              : <circle cx={cx} cy={16} r={3.5} fill="#fafafa" stroke="#a1a1aa" strokeWidth={1.2} strokeDasharray={t > now ? '2 2' : undefined} />}
            <text x={cx} y={38} textAnchor="middle" fontSize={10} fill="#a1a1aa" fontFamily="Geist Mono">
              {d.slice(5)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
