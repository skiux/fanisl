import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react'
import { fetchKnowledgeContent, fetchKnowledgeContents, fetchKnowledgeCreators, fetchKnowledgeScoreboard, fetchKnowledgeUnits } from '../../api'

// ---------------------------------------------------------------------------
// 知识库：研究工作台（阅读优先）。单列 ~700px 文档流 + 右侧淡化的信源栏。
// 布局原则：留白与字号分层组织信息，不用表格/边框卡片；一屏一个视觉重点。
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = { claim: '判断', method: '方法', concept: '认知' }

const GRADE_CLS: Record<string, string> = {
  A: 'text-emerald-600', B: 'text-zinc-500', C: 'text-amber-600', D: 'text-zinc-400',
}

const DIR: Record<string, string> = { up: '↑', down: '↓', flat: '→', range: '↔', vol_up: 'σ↑', vol_down: 'σ↓' }

const OUTCOME: Record<string, { label: string; cls: string }> = {
  hit: { label: '✓', cls: 'bg-emerald-50 text-emerald-600' },
  partial: { label: '½', cls: 'bg-amber-50 text-amber-600' },
  miss: { label: '✗', cls: 'bg-rose-50 text-rose-500' },
  condition_not_met: { label: '未触发', cls: 'bg-zinc-100 text-zinc-400' },
  condition_unverifiable: { label: '不可验', cls: 'bg-zinc-100 text-zinc-400' },
  unpriceable: { label: '无价格', cls: 'bg-zinc-100 text-zinc-400' },
}

function claimHeadline(p: any): string {
  const parts = [p.asset_symbol ?? p.asset_text]
  if (p.direction) parts.push(DIR[p.direction] ?? p.direction)
  if (p.magnitude?.target != null) parts.push(`目标 ${p.magnitude.target}`)
  if (p.magnitude?.low != null && p.magnitude?.high != null) parts.push(`${p.magnitude.low} ~ ${p.magnitude.high}`)
  else if (p.magnitude?.low != null) parts.push(`守 ${p.magnitude.low}`)
  else if (p.magnitude?.high != null) parts.push(`压 ${p.magnitude.high}`)
  return parts.join(' ')
}

// L0 raw = 转录正文 + "## 视觉笔记" 列表（llm.render_l0_text 的格式约定）
function splitRaw(raw: string): { transcript: string; notes: { t: string; kind: string; note: string }[] } {
  const [body, notesPart] = raw.split(/\n## 视觉笔记[^\n]*\n?/)
  const notes = (notesPart ?? '')
    .split('\n')
    .map((l) => l.match(/^- \[(.+?)\] \((.+?)\) (.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ t: m[1], kind: m[2], note: m[3] }))
  return { transcript: (body ?? '').trim(), notes }
}

const fmtDate = (s: string) => {
  const d = new Date(s)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
const monthKey = (s: string) => {
  const d = new Date(s)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

// --- 详情：单元卡（一条知识 = 一段可读的块，无边框） -------------------------
function UnitBlock({ u }: { u: any }) {
  const p = u.payload ?? {}
  const deadline = p.scoring_spec?.eval_ladder?.slice(-1)[0]
  const headline = u.kind === 'claim' ? claimHeadline(p) : u.kind === 'method' ? p.name : p.canonical_statement
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[15px] font-medium leading-snug text-zinc-900">{headline}</span>
        {u.kind === 'claim' && (u.scores ?? []).map((s: any, i: number) => {
          const o = OUTCOME[s.outcome] ?? { label: s.outcome, cls: 'bg-zinc-100 text-zinc-400' }
          return (
            <span key={i} title={`${s.horizon_label} · ${s.outcome}${s.realized?.eval_close != null ? ` · 评估价 ${s.realized.eval_close}` : ''}`}
              className={`rounded px-1.5 py-px font-mono text-[10.5px] ${o.cls}`}>
              {s.horizon_label.slice(5)} {o.label}
            </span>
          )
        })}
      </div>
      <div className="mt-1 text-[12px] text-zinc-400">
        {u.kind === 'claim' && (
          <>
            <span className={`font-mono font-semibold ${GRADE_CLS[p.verifiability] ?? ''}`}>{p.verifiability}</span>
            {deadline && <span> · 至 {deadline}</span>}
            {u.ref_price_at_publish != null && <span> · 基准 {u.ref_price_at_publish}</span>}
            {p.stance_strength !== 'explicit' && <span> · {p.stance_strength === 'hedged' ? '对冲表述' : '试探表述'}</span>}
          </>
        )}
        {u.kind === 'method' && (
          <span>{p.family} · 可测性 {p.testability}{p.summary ? ` · ${p.summary}` : ''}</span>
        )}
        {u.kind === 'concept' && <span>{p.category}{p.regime_qualifier ? ` · ${p.regime_qualifier}` : ''}</span>}
      </div>
      <blockquote className="mt-2.5 border-l-2 border-zinc-200 pl-3.5 text-[13.5px] leading-relaxed text-zinc-500">
        {u.locator && <span className="mr-1.5 font-mono text-[11px] text-zinc-300">{u.locator}</span>}
        {u.quote}
      </blockquote>
      {u.kind === 'claim' && p.condition_text && (
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">前置条件：{p.condition_text}{!p.condition_observable && '（不可机械判定）'}</p>
      )}
      {u.kind === 'method' && (p.rules ?? []).length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-zinc-600">
          {p.rules.map((r: string, i: number) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {u.kind === 'claim' && p.scoring_spec?.success_def && (
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">评分口径：{p.scoring_spec.success_def}</p>
      )}
    </div>
  )
}

// --- 详情：阅读页 -------------------------------------------------------------
function Reading({ detail, units, onBack }: { detail: any; units: any[]; onBack: () => void }) {
  const { transcript, notes } = splitRaw(detail.raw ?? '')
  const groups = useMemo(() => (['claim', 'method', 'concept'] as const)
    .map((k) => ({ kind: k, items: units.filter((u) => u.kind === k) }))
    .filter((g) => g.items.length > 0), [units])
  return (
    <div className="mx-auto max-w-[44rem] px-6 pb-28 pt-10">
      <div className="flex items-center justify-between text-[13px] text-zinc-400">
        <button onClick={onBack} className="flex items-center gap-1.5 transition-colors hover:text-zinc-700">
          <ArrowLeft size={14} /> 知识库
        </button>
        {detail.url && (
          <a href={detail.url} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-zinc-700">
            原视频 <ArrowSquareOut size={13} />
          </a>
        )}
      </div>

      <h1 className="mt-8 text-[23px] font-semibold leading-snug tracking-tight text-zinc-900">
        {detail.title ?? `内容 #${detail.id}`}
      </h1>
      <p className="mt-3 text-[13px] text-zinc-400">
        {detail.creator} · {fmtDate(detail.published_at)} · {(detail.raw ?? '').length.toLocaleString()} 字转录 · {units.length} 个知识单元
      </p>

      <div className="mt-14 space-y-14">
        {groups.map((g) => (
          <section key={g.kind}>
            <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-zinc-400">
              {KIND_LABEL[g.kind]} · {g.items.length}
            </h2>
            <div className="mt-6 space-y-9">
              {g.items.map((u) => <UnitBlock key={u.id} u={u} />)}
            </div>
          </section>
        ))}
        {units.length === 0 && (
          <p className="text-[14px] text-zinc-400">这篇还没有提取知识单元。</p>
        )}

        <section className="border-t border-zinc-100 pt-10">
          <details>
            <summary className="cursor-pointer list-none text-[13px] text-zinc-400 transition-colors hover:text-zinc-700">
              原文转录 · {(transcript ?? '').length.toLocaleString()} 字 ›
            </summary>
            <div className="mt-6 whitespace-pre-wrap text-[14.5px] leading-[1.95] text-zinc-700">{transcript}</div>
          </details>
          {notes.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer list-none text-[13px] text-zinc-400 transition-colors hover:text-zinc-700">
                画面笔记 · {notes.length} ›
              </summary>
              <ul className="mt-6 space-y-3">
                {notes.map((n, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-zinc-500">
                    <span className="mr-2 font-mono text-[11px] text-zinc-300">{n.t}</span>
                    {n.note}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  )
}

// --- 首页：内容流 + 侧栏 -------------------------------------------------------
export default function Knowledge() {
  const [creators, setCreators] = useState<any[]>([])
  const [contents, setContents] = useState<any[]>([])
  const [board, setBoard] = useState<any[]>([])
  const [filter, setFilter] = useState<number | null>(null)
  const [detail, setDetail] = useState<any | null>(null)
  const [units, setUnits] = useState<any[]>([])

  const openDetail = useCallback((id: number) => {
    fetchKnowledgeContent(id).then(setDetail).catch(() => {})
    fetchKnowledgeUnits(id).then(setUnits).catch(() => setUnits([]))
  }, [])

  const refresh = useCallback(() => {
    fetchKnowledgeCreators().then(setCreators).catch(() => {})
    fetchKnowledgeContents().then(setContents).catch(() => {})
    fetchKnowledgeScoreboard().then(setBoard).catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 60000)
    return () => clearInterval(id)
  }, [refresh])

  const shown = useMemo(
    () => (filter == null ? contents : contents.filter((c) => c.creator_id === filter)),
    [contents, filter])

  const byMonth = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const c of shown) {
      const k = c.published_at ? monthKey(c.published_at) : '未知时间'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(c)
    }
    return [...m.entries()]
  }, [shown])

  const totals = useMemo(() => ({
    units: contents.reduce((a, c) => a + (c.n_units ?? 0), 0),
    scored: board.reduce((a, b) => a + (b.scored ?? 0), 0),
  }), [contents, board])

  if (detail) {
    return (
      <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
        <Reading detail={detail} units={units} onBack={() => { setDetail(null); setUnits([]) }} />
      </div>
    )
  }

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto grid max-w-[68rem] gap-20 px-6 pb-28 pt-12 xl:grid-cols-[minmax(0,44rem)_13rem] xl:justify-center">
        <main className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight text-zinc-900">知识库</h1>
          <p className="mt-2.5 text-[13.5px] text-zinc-400">
            {creators.length} 位信源 · {contents.length} 篇 · {totals.units} 个知识单元 · {totals.scored} 个已到期评分
          </p>

          <div className="mt-9 flex items-center gap-5 text-[13.5px]">
            <button onClick={() => setFilter(null)}
              className={filter == null ? 'font-medium text-zinc-900' : 'text-zinc-400 transition-colors hover:text-zinc-600'}>
              全部
            </button>
            {creators.map((c) => (
              <button key={c.id} onClick={() => setFilter(filter === c.id ? null : c.id)}
                className={filter === c.id ? 'font-medium text-zinc-900' : 'text-zinc-400 transition-colors hover:text-zinc-600'}>
                {c.name}
              </button>
            ))}
          </div>

          {byMonth.map(([month, items]) => (
            <section key={month} className="mt-11">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-zinc-400">{month}</h2>
              <div className="mt-3">
                {items.map((c) => (
                  <article key={c.id} onClick={() => openDetail(c.id)}
                    className="-mx-4 cursor-pointer rounded-xl px-4 py-4 transition-colors hover:bg-zinc-50">
                    <h3 className="text-[15.5px] font-medium leading-snug text-zinc-900">{c.title ?? '—'}</h3>
                    <p className="mt-1.5 text-[12.5px] text-zinc-400">
                      {c.creator}
                      {c.published_at && <> · {new Date(c.published_at).getMonth() + 1} 月 {new Date(c.published_at).getDate()} 日</>}
                      {c.n_units > 0 && (
                        <>
                          {' '}· {[
                            c.n_claims > 0 ? `${c.n_claims} 判断` : null,
                            c.n_methods > 0 ? `${c.n_methods} 方法` : null,
                            c.n_concepts > 0 ? `${c.n_concepts} 认知` : null,
                          ].filter(Boolean).join('，')}
                        </>
                      )}
                      {(c.n_hit > 0 || c.n_miss > 0 || c.n_partial > 0) && (
                        <span className="ml-2 font-mono text-[11.5px]">
                          {c.n_hit > 0 && <span className="text-emerald-600">{c.n_hit}✓</span>}
                          {c.n_partial > 0 && <span className="ml-1 text-amber-600">{c.n_partial}½</span>}
                          {c.n_miss > 0 && <span className="ml-1 text-rose-500">{c.n_miss}✗</span>}
                        </span>
                      )}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {shown.length === 0 && (
            <p className="mt-16 text-[14px] text-zinc-400">还没有内容。用 backfill_transcripts 抓取信源的近期视频。</p>
          )}
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-12 space-y-8 text-[12.5px] leading-relaxed">
            <div>
              <h2 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-zinc-300">信源战绩</h2>
              <div className="mt-4 space-y-5">
                {board.map((b) => (
                  <div key={b.creator_id}>
                    <div className="font-medium text-zinc-700">{b.name}</div>
                    <div className="mt-0.5 text-zinc-400">
                      {b.hit_rate != null ? <>命中率 {(b.hit_rate * 100).toFixed(0)}%<span className="mx-1 text-zinc-300">·</span></> : null}
                      已到期 {b.scored}/{b.claims - b.d_claims}
                    </div>
                    <div className="text-zinc-400">
                      含糊率 {b.vague_rate != null ? `${(b.vague_rate * 100).toFixed(0)}%` : '—'}
                      {b.sign_p != null && (
                        <span title={`方向类判断 ${b.sign_hits}/${b.sign_n}，vs 50% 随机基线单侧二项检验`}>
                          <span className="mx-1 text-zinc-300">·</span>p {b.sign_p}{b.sign_side === 'below' ? '↓' : '↑'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-zinc-300">
              评分为到期机械执行（hit=1，partial=0.5）。样本仍小，仅供跟踪。
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
