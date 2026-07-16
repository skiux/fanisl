import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, Books, CaretLeft, CaretRight, UsersThree, VideoCamera } from '@phosphor-icons/react'
import { fetchKnowledgeContent, fetchKnowledgeContents, fetchKnowledgeCreators, fetchKnowledgeScoreboard, fetchKnowledgeUnits } from '../../api'
import { Badge, EmptyState, Kpi, KpiRow, PageShell, Panel } from '../ui'
import { when } from '../trading'

const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'high' }> = {
  new: { label: '新入库', tone: 'neutral' },
  triaged: { label: '已分诊', tone: 'neutral' },
  awaiting_manual: { label: '待提取', tone: 'high' },
  extracted: { label: '已提取', tone: 'accent' },
  skipped: { label: '跳过', tone: 'neutral' },
}

const KIND: Record<string, { label: string; tone: 'neutral' | 'accent' | 'high' }> = {
  claim: { label: '判断', tone: 'accent' },
  method: { label: '方法', tone: 'high' },
  concept: { label: '认知', tone: 'neutral' },
}

// 可验证性分级的着色（extraction-guide.md §2）
const GRADE_CLS: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700',
  B: 'bg-zinc-100 text-zinc-600',
  C: 'bg-amber-50 text-amber-700',
  D: 'bg-rose-50 text-rose-600',
}

const DIR: Record<string, string> = { up: '↑', down: '↓', flat: '→', range: '↔', vol_up: 'σ↑', vol_down: 'σ↓' }

// 评分结果徽标（L2 到期机械评分）
const OUTCOME: Record<string, { label: string; cls: string }> = {
  hit: { label: '✓', cls: 'bg-emerald-100 text-emerald-700' },
  partial: { label: '½', cls: 'bg-amber-100 text-amber-700' },
  miss: { label: '✗', cls: 'bg-rose-100 text-rose-700' },
  condition_not_met: { label: '条件未触发', cls: 'bg-zinc-100 text-zinc-500' },
  condition_unverifiable: { label: '条件不可验', cls: 'bg-zinc-100 text-zinc-400' },
  unpriceable: { label: '不可定价', cls: 'bg-zinc-100 text-zinc-400' },
}

// claim 载荷 → 一行摘要（标的 方向 目标/区间）
function claimLine(p: any): string {
  const parts = [p.asset_symbol ?? p.asset_text]
  if (p.direction) parts.push(DIR[p.direction] ?? p.direction)
  if (p.magnitude?.target != null) parts.push(`目标 ${p.magnitude.target}`)
  if (p.magnitude?.low != null) parts.push(`区间 ${p.magnitude.low}~${p.magnitude.high}`)
  if (p.magnitude?.pct != null) parts.push(`${p.magnitude.pct}%`)
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

// 知识引擎页：信源 + L0 内容库（转录/视觉笔记预览）。提取/评分视图随 K3/K4 加。
export default function Knowledge() {
  const [creators, setCreators] = useState<any[]>([])
  const [contents, setContents] = useState<any[]>([])
  const [board, setBoard] = useState<any[]>([])
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
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [refresh])

  const stats = useMemo(() => {
    const by = (s: string) => contents.filter((c) => c.status === s).length
    return {
      total: contents.length,
      chars: contents.reduce((a, c) => a + (c.raw_len ?? 0), 0),
      pending: by('new') + by('triaged') + by('awaiting_manual'),
      extracted: by('extracted'),
    }
  }, [contents])

  if (detail) {
    const { transcript, notes } = splitRaw(detail.raw ?? '')
    const st = STATUS[detail.status] ?? { label: detail.status, tone: 'neutral' as const }
    return (
      <PageShell
        title={detail.title ?? `内容 #${detail.id}`}
        sub={`${detail.creator} · ${detail.platform} · 发布 ${when(detail.published_at)} · ${detail.lang ?? '?'} · ${(detail.raw ?? '').length.toLocaleString()} 字`}
        controls={
          <div className="flex items-center gap-2">
            <button onClick={() => { setDetail(null); setUnits([]) }}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px">
              <CaretLeft size={13} weight="bold" /> 返回列表
            </button>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100">
                <ArrowSquareOut size={13} weight="bold" /> 原视频
              </a>
            )}
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <Panel className="lg:col-span-3" title="转录全文（Gemini URL 直读）">
            <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-700">
              {transcript || <EmptyState title="无转录正文" />}
            </div>
          </Panel>
          <Panel className="lg:col-span-2" title={`视觉笔记 · ${notes.length}（画面信息，带时间戳）`}>
            {notes.length === 0 ? (
              <EmptyState title="无视觉笔记" />
            ) : (
              <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
                {notes.map((n, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    <span className="mr-1.5 inline-block rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">{n.t}</span>
                    <span className="mr-1.5 text-[11px] uppercase tracking-wide text-zinc-400">{n.kind}</span>
                    <span className="text-zinc-700">{n.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel className="mt-3"
          title={`提取单元 · ${units.length}${units[0] ? `（${units[0].extractor_version}）` : ''}`}>
          {units.length === 0 ? (
            <EmptyState title="尚未提取" hint="python -m analyzer.knowledge.import_units <units.json>" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {units.map((u) => {
                const k = KIND[u.kind] ?? { label: u.kind, tone: 'neutral' as const }
                const p = u.payload ?? {}
                const deadline = p.scoring_spec?.eval_ladder?.slice(-1)[0]
                return (
                  <li key={u.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={k.tone}>{k.label}</Badge>
                      {u.kind === 'claim' && (
                        <>
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${GRADE_CLS[p.verifiability] ?? ''}`}>{p.verifiability}</span>
                          <span className="text-[13px] font-medium text-zinc-800">{claimLine(p)}</span>
                          {deadline && <span className="font-mono text-[11px] text-zinc-400">至 {deadline}</span>}
                          {u.ref_price_at_publish != null && (
                            <span className="font-mono text-[11px] text-zinc-400">@{u.ref_price_at_publish}</span>
                          )}
                          {p.stance_strength !== 'explicit' && (
                            <span className="text-[11px] text-zinc-400">({p.stance_strength === 'hedged' ? '对冲' : '试探'})</span>
                          )}
                          {(u.scores ?? []).map((s: any, i: number) => {
                            const o = OUTCOME[s.outcome] ?? { label: s.outcome, cls: 'bg-zinc-100 text-zinc-500' }
                            return (
                              <span key={i} title={`${s.horizon_label} · ${s.outcome}${s.realized?.eval_close != null ? ` · 评估价 ${s.realized.eval_close}` : ''}`}
                                className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${o.cls}`}>
                                {s.horizon_label.slice(5)} {o.label}
                              </span>
                            )
                          })}
                        </>
                      )}
                      {u.kind === 'method' && (
                        <span className="text-[13px] font-medium text-zinc-800">
                          {p.name} <span className="text-[11px] font-normal text-zinc-400">{p.family} · 可测性 {p.testability} · {p.rules?.length ?? 0} 条规则</span>
                        </span>
                      )}
                      {u.kind === 'concept' && (
                        <span className="text-[13px] text-zinc-800">{p.canonical_statement}
                          <span className="ml-1.5 text-[11px] text-zinc-400">{p.category}</span>
                        </span>
                      )}
                      <span className="ml-auto flex flex-wrap gap-1">
                        {(u.tags ?? []).map((t: string) => (
                          <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-500">{t}</span>
                        ))}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                      {u.locator && <span className="mr-1.5 font-mono text-[10.5px] text-zinc-400">[{u.locator}]</span>}
                      「{u.quote}」
                    </div>
                    {u.kind === 'claim' && p.condition_text && (
                      <div className="mt-0.5 text-[11.5px] text-amber-700/80">条件：{p.condition_text}{!p.condition_observable && '（不可机械判定）'}</div>
                    )}
                    {u.kind === 'claim' && p.scoring_spec?.success_def && (
                      <div className="mt-0.5 text-[11.5px] text-zinc-400">评分：{p.scoring_spec.success_def}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="知识引擎"
      sub="持续学习、验证、沉淀投资知识 · L0 原文库 + L1 提取单元（判断/方法/认知）· 评分随 K4 上线"
    >
      <KpiRow cols={4}>
        <Kpi label="信源" value={String(creators.length)} />
        <Kpi label="内容" value={String(stats.total)} sub={`${(stats.chars / 1000).toFixed(1)}k 字`} />
        <Kpi label="待提取" value={String(stats.pending)} tone={stats.pending > 0 ? 'up' : 'neutral'} />
        <Kpi label="已提取" value={String(stats.extracted)} />
      </KpiRow>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-2">
        <Panel
          title={<span className="flex items-center gap-1.5"><UsersThree size={15} weight="bold" className="text-emerald-600" />信源 · {creators.length}</span>}>
          {creators.length === 0 ? (
            <EmptyState title="还没有登记信源" hint="python -m analyzer.knowledge.register <名称> <平台> <handle>" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {creators.map((c) => (
                <li key={c.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-medium text-zinc-800">{c.name}</span>
                    <span className="text-[11px] text-zinc-400">{c.lang}{c.focus ? ` · ${c.focus}` : ''}</span>
                    <span className="ml-auto font-mono text-[11px] text-zinc-400">
                      {contents.filter((x) => x.creator_id === c.id).length} 条
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {(c.handles ?? []).map((h: any, i: number) => (
                      <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
                        {h.platform}:{h.handle}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={<span>信源联赛表 · L2 <span className="ml-1 text-[11px] font-normal normal-case text-zinc-400">到期机械评分 · hit=1 partial=0.5</span></span>}>
          {board.length === 0 || board.every((b) => !b.scored) ? (
            <EmptyState title="还没有到期评分" hint="python -m analyzer.knowledge.scorers" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th className="py-1 pr-2 font-medium">信源</th>
                    <th className="py-1 pr-2 text-right font-medium">已到期</th>
                    <th className="py-1 pr-2 text-right font-medium">命中率</th>
                    <th className="py-1 pr-2 text-right font-medium">方向类 p</th>
                    <th className="py-1 text-right font-medium">含糊率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {board.map((b) => (
                    <tr key={b.creator_id} className="text-zinc-700">
                      <td className="py-1.5 pr-2 font-medium text-zinc-800">{b.name}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{b.scored}<span className="text-zinc-400">/{b.claims - b.d_claims}</span></td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                        {b.hit_rate != null ? `${(b.hit_rate * 100).toFixed(0)}%` : '—'}
                        <span className="ml-1 text-[10.5px] text-zinc-400">{b.hits}✓{b.partials > 0 ? ` ${b.partials}½` : ''} {b.misses}✗</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                        {b.sign_p != null ? (
                          <span title={`sign 类 ${b.sign_hits}/${b.sign_n} vs 50% 随机基线（单侧）`}
                            className={b.sign_p < 0.05 ? (b.sign_side === 'above' ? 'text-emerald-600' : 'text-rose-600') : 'text-zinc-500'}>
                            {b.sign_p}{b.sign_side === 'below' ? '↓' : '↑'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-zinc-500">
                        {b.vague_rate != null ? `${(b.vague_rate * 100).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                样本仍小，数字仅供跟踪不作结论；「方向类 p」= sign 判断 vs 50% 随机基线的单侧二项检验（↑优于随机 ↓劣于随机），其余评分类型暂无基线。
              </p>
            </div>
          )}
        </Panel>
        </div>

        <Panel className="lg:col-span-3"
          title={<span className="flex items-center gap-1.5"><Books size={15} weight="bold" className="text-zinc-600" />L0 内容库 · {contents.length}</span>}>
          {contents.length === 0 ? (
            <EmptyState icon={<VideoCamera size={26} weight="thin" />} title="还没有入库内容"
              hint="python -m analyzer.knowledge.transcribe_video <handle> <video_id>" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th className="py-1.5 pr-3 font-medium">标题</th>
                    <th className="py-1.5 pr-3 font-medium">信源</th>
                    <th className="py-1.5 pr-3 font-medium">发布</th>
                    <th className="py-1.5 pr-3 text-right font-medium">字数</th>
                    <th className="py-1.5 pr-3 text-right font-medium">单元</th>
                    <th className="py-1.5 pr-3 font-medium">状态</th>
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {contents.map((c) => {
                    const st = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }
                    return (
                      <tr key={c.id} onClick={() => openDetail(c.id)}
                        className="group cursor-pointer text-zinc-700 transition-colors hover:bg-zinc-50/70">
                        <td className="max-w-[340px] truncate py-2 pr-3 font-medium text-zinc-800" title={c.title}>{c.title ?? '—'}</td>
                        <td className="py-2 pr-3 text-zinc-500">{c.creator}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{when(c.published_at)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">{(c.raw_len ?? 0).toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">{c.n_units ?? 0}</td>
                        <td className="py-2 pr-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                        <td className="py-2 text-right">
                          <CaretRight size={13} className="inline text-zinc-300 transition-colors group-hover:text-zinc-500" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  )
}
