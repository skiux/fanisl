import { useMemo, useRef } from 'react'
import { ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react'
import {
  fetchKnowledgeContent, fetchKnowledgeContents, fetchKnowledgeCreators,
  fetchKnowledgeScoreboard, fetchKnowledgeTags, fetchKnowledgeUnits, fetchKnowledgeUnitsBrowse,
} from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate, type Route } from '../../lib/router'
import { AsOf, ErrorState, QueryGate, Skeleton } from '../ui'
import { KIND_LABEL, UnitBlock } from '../knowledgeUnits'
import KnowledgeUnit from './KnowledgeUnit'

// 知识库（Ledger 容器）：同一批对象的四种入口（PRODUCT.md §3）——
// 时间流（内容为单位）/ 判断 / 方法 / 认知（跨内容单元浏览）/ 标签（枢纽）。
// 联赛表=按信源聚合的视图（侧栏；窄屏降级主栏后置）。

const fmtDate = (s: string) => {
  const d = new Date(s)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
const monthKey = (s: string) => {
  const d = new Date(s)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

// --- 入口导航（时间流 / 判断 / 方法 / 认知 / 标签）---------------------------
function EntryNav({ active }: { active: string }) {
  const items = [
    { key: 'stream', label: '时间流', to: '/knowledge' },
    { key: 'claim', label: '判断', to: '/knowledge/browse?kind=claim' },
    { key: 'method', label: '方法', to: '/knowledge/browse?kind=method' },
    { key: 'concept', label: '认知', to: '/knowledge/browse?kind=concept' },
    { key: 'tags', label: '标签', to: '/knowledge/tags' },
  ]
  return (
    <div className="mt-9 flex items-center gap-5 text-sm">
      {items.map((it) => (
        <button key={it.key} onClick={() => navigate(it.to)}
          className={active === it.key ? 'font-medium text-zinc-900' : 'text-zinc-400 transition-colors hover:text-zinc-600'}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

// --- 侧栏：信源战绩（联赛表视图）---------------------------------------------
function LeagueAside({ onCreator }: { onCreator: (id: number) => void }) {
  const board = useQuery(() => fetchKnowledgeScoreboard(), [], { pollMs: 60000 })
  return (
    <aside className="min-w-0">
      <div className="space-y-8 text-xs leading-relaxed xl:sticky xl:top-12">
        <div>
          <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-300">信源战绩</h2>
          <QueryGate q={board} skeletonHeight={120}>
            {(rows) => (
              <div className="mt-4 space-y-5">
                {rows.map((b: any) => (
                  <div key={b.creator_id}>
                    <button onClick={() => onCreator(b.creator_id)}
                      className="font-medium text-zinc-700 transition-colors hover:text-zinc-900">{b.name}</button>
                    <div className="mt-0.5 text-zinc-400">
                      {b.hit_rate != null ? <>命中率 <span className="font-mono">{(b.hit_rate * 100).toFixed(0)}%</span><span className="mx-1 text-zinc-300">·</span></> : null}
                      已到期 <span className="font-mono">{b.scored}/{b.claims - b.d_claims}</span>
                    </div>
                    <div className="text-zinc-400">
                      含糊率 {b.vague_rate != null ? <span className="font-mono">{(b.vague_rate * 100).toFixed(0)}%</span> : '—'}
                      {b.sign_p != null && (
                        <span title={`方向类判断 ${b.sign_hits}/${b.sign_n}，vs 50% 随机基线单侧二项检验`}>
                          <span className="mx-1 text-zinc-300">·</span>p <span className="font-mono">{b.sign_p}</span>{b.sign_side === 'below' ? '↓' : '↑'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </QueryGate>
        </div>
        <p className="text-2xs leading-relaxed text-zinc-300">
          评分为到期机械执行（hit=1，partial=0.5）。样本仍小，仅供跟踪。
        </p>
      </div>
    </aside>
  )
}

function Shell({ children, onCreator }: { children: React.ReactNode; onCreator: (id: number) => void }) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto grid max-w-[68rem] gap-x-20 gap-y-12 px-6 pb-28 pt-12 xl:grid-cols-[minmax(0,44rem)_13rem] xl:justify-center">
        <main className="min-w-0">{children}</main>
        <LeagueAside onCreator={onCreator} />
      </div>
    </div>
  )
}

// --- 阅读页 -------------------------------------------------------------------
function Reading({ id }: { id: number }) {
  const detail = useQuery(() => fetchKnowledgeContent(id), [id])
  const units = useQuery(() => fetchKnowledgeUnits(id), [id])
  const transcriptRef = useRef<HTMLDetailsElement>(null)

  const openTranscript = () => {
    const el = transcriptRef.current
    if (!el) return
    el.open = true
    el.scrollIntoView({ block: 'start' })
  }

  // L0 raw = 转录正文 + "## 视觉笔记" 列表（llm.render_l0_text 的格式约定）
  const splitRaw = (raw: string) => {
    const [body, notesPart] = raw.split(/\n## 视觉笔记[^\n]*\n?/)
    const notes = (notesPart ?? '')
      .split('\n')
      .map((l) => l.match(/^- \[(.+?)\] \((.+?)\) (.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ t: m[1], kind: m[2], note: m[3] }))
    return { transcript: (body ?? '').trim(), notes }
  }

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[44rem] px-6 pb-28 pt-10">
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <button onClick={() => navigate('/knowledge')}
            className="flex items-center gap-1.5 transition-colors hover:text-zinc-700">
            <ArrowLeft size={14} /> 知识库
          </button>
          {detail.data?.url && (
            <a href={detail.data.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-zinc-700">
              原视频 <ArrowSquareOut size={13} />
            </a>
          )}
        </div>

        <QueryGate q={detail} skeletonHeight={320}>
          {(d) => {
            const { transcript, notes } = splitRaw(d.raw ?? '')
            const us = units.data ?? []
            const groups = (['claim', 'method', 'concept'] as const)
              .map((k) => ({ kind: k, items: us.filter((u: any) => u.kind === k) }))
              .filter((g) => g.items.length > 0)
            return (
              <>
                <h1 className="mt-8 text-2xl font-semibold leading-snug tracking-tight text-zinc-900">
                  {d.title ?? `内容 #${d.id}`}
                </h1>
                <p className="mt-3 text-sm text-zinc-400">
                  {d.creator} · {fmtDate(d.published_at)} · {(d.raw ?? '').length.toLocaleString()} 字转录 · {us.length} 个知识单元
                </p>

                <div className="mt-14 space-y-14">
                  {units.error && us.length === 0 && <ErrorState error={units.error} onRetry={units.refetch} />}
                  {groups.map((g) => (
                    <section key={g.kind}>
                      <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                        {KIND_LABEL[g.kind]} · {g.items.length}
                      </h2>
                      <div className="mt-6 space-y-9">
                        {g.items.map((u: any) => <UnitBlock key={u.id} u={u} onLocator={openTranscript} />)}
                      </div>
                    </section>
                  ))}
                  {!units.loading && !units.error && us.length === 0 && (
                    <p className="text-base text-zinc-400">这篇还没有提取知识单元。</p>
                  )}

                  <section className="border-t border-zinc-100 pt-10">
                    <details ref={transcriptRef}>
                      <summary className="cursor-pointer list-none text-sm text-zinc-400 transition-colors hover:text-zinc-700">
                        原文转录 · {(transcript ?? '').length.toLocaleString()} 字 ›
                      </summary>
                      <div className="mt-6 whitespace-pre-wrap text-md leading-[1.9] text-zinc-700">{transcript}</div>
                    </details>
                    {notes.length > 0 && (
                      <details className="mt-5">
                        <summary className="cursor-pointer list-none text-sm text-zinc-400 transition-colors hover:text-zinc-700">
                          画面笔记 · {notes.length} ›
                        </summary>
                        <ul className="mt-6 space-y-3">
                          {notes.map((n, i) => (
                            <li key={i} className="text-sm leading-relaxed text-zinc-500">
                              <span className="mr-2 font-mono text-2xs text-zinc-300">{n.t}</span>
                              {n.note}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                </div>
              </>
            )
          }}
        </QueryGate>
      </div>
    </div>
  )
}

// --- 跨内容浏览（判断/方法/认知；支持 tag/symbol/creator 过滤）---------------
function Browse({ route }: { route: Route }) {
  const kind = route.query.get('kind') ?? undefined
  const tag = route.query.get('tag') ?? undefined
  const symbol = route.query.get('symbol') ?? undefined
  const creator = route.query.get('creator') ? Number(route.query.get('creator')) : undefined

  const units = useQuery(
    () => fetchKnowledgeUnitsBrowse({ kind, tag, symbol, creator, limit: 300 }),
    [kind, tag, symbol, creator])

  const byMonth = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const u of units.data ?? []) {
      const k = u.published_at ? monthKey(u.published_at) : '未知时间'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(u)
    }
    return [...m.entries()]
  }, [units.data])

  const clearTo = `/knowledge/browse${kind ? `?kind=${kind}` : ''}`
  const filters = [
    tag && { label: `标签 ${tag}` },
    symbol && { label: `标的 ${symbol}` },
    creator && { label: `信源 #${creator}` },
  ].filter(Boolean) as { label: string }[]

  return (
    <Shell onCreator={(id) => navigate(`/knowledge/browse?${new URLSearchParams({ ...(kind ? { kind } : {}), creator: String(id) })}`)}>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">知识库</h1>
      <p className="mt-2.5 text-sm text-zinc-400">
        {kind ? `${KIND_LABEL[kind]} · ` : ''}{(units.data ?? []).length} 个单元
        {units.asOf && <> · <AsOf ts={units.asOf} /></>}
      </p>
      <EntryNav active={kind ?? 'stream'} />

      {filters.length > 0 && (
        <p className="mt-4 text-xs text-zinc-400">
          筛选：{filters.map((f) => f.label).join(' · ')}
          <button onClick={() => navigate(clearTo)}
            className="ml-2 underline decoration-zinc-200 transition-colors hover:text-zinc-600">清除</button>
        </p>
      )}

      {units.data == null ? (
        <div className="mt-11">
          {units.loading ? <Skeleton height={280} />
            : units.error ? <ErrorState error={units.error} onRetry={units.refetch} />
            : <Skeleton height={280} />}
        </div>
      ) : (units.data.length === 0 ? (
        <p className="mt-16 text-base text-zinc-400">此筛选下没有单元。</p>
      ) : (
        byMonth.map(([month, items]) => (
          <section key={month} className="mt-11">
            <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">{month}</h2>
            <div className="mt-6 space-y-9">
              {items.map((u: any) => <UnitBlock key={u.id} u={u} context />)}
            </div>
          </section>
        ))
      ))}
    </Shell>
  )
}

// --- 标签枢纽 -----------------------------------------------------------------
function TagsIndex() {
  const tags = useQuery(() => fetchKnowledgeTags(), [])
  return (
    <Shell onCreator={(id) => navigate(`/knowledge?creator=${id}`)}>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">知识库</h1>
      <p className="mt-2.5 text-sm text-zinc-400">
        {(tags.data ?? []).length} 个标签（受控词表，提取时打）
        {tags.asOf && <> · <AsOf ts={tags.asOf} /></>}
      </p>
      <EntryNav active="tags" />
      <QueryGate q={tags} skeletonHeight={280}>
        {(rows) => (
          <div className="mt-9">
            {rows.map((t: any) => (
              <button key={t.tag} onClick={() => navigate(`/knowledge/browse?tag=${encodeURIComponent(t.tag)}`)}
                className="-mx-4 flex w-[calc(100%+2rem)] items-baseline justify-between gap-4 rounded-xl px-4 py-2.5 text-left transition-colors duration-150 hover:bg-zinc-50">
                <span className="font-mono text-md text-zinc-800">{t.tag}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
                  {t.n}
                  <span className="ml-2 text-zinc-300">
                    {[t.n_claims > 0 ? `判 ${t.n_claims}` : null, t.n_methods > 0 ? `法 ${t.n_methods}` : null,
                      t.n_concepts > 0 ? `知 ${t.n_concepts}` : null].filter(Boolean).join(' ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </QueryGate>
    </Shell>
  )
}

// --- 时间流（默认入口，内容为单位）--------------------------------------------
function Stream({ route }: { route: Route }) {
  const creators = useQuery(() => fetchKnowledgeCreators(), [], { pollMs: 60000 })
  const contents = useQuery(() => fetchKnowledgeContents(), [], { pollMs: 60000 })
  const board = useQuery(() => fetchKnowledgeScoreboard(), [], { pollMs: 60000 })

  const filter = route.query.get('creator') ? Number(route.query.get('creator')) : null
  const setFilter = (id: number | null) => navigate(id == null ? '/knowledge' : `/knowledge?creator=${id}`)

  const shown = useMemo(
    () => (filter == null ? contents.data ?? [] : (contents.data ?? []).filter((c) => c.creator_id === filter)),
    [contents.data, filter])

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
    units: (contents.data ?? []).reduce((a, c) => a + (c.n_units ?? 0), 0),
    scored: (board.data ?? []).reduce((a, b) => a + (b.scored ?? 0), 0),
  }), [contents.data, board.data])

  return (
    <Shell onCreator={setFilter}>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">知识库</h1>
      <p className="mt-2.5 text-sm text-zinc-400">
        {(creators.data ?? []).length} 位信源 · {(contents.data ?? []).length} 篇 · {totals.units} 个知识单元 · {totals.scored} 个已到期评分
        {contents.asOf && <> · <AsOf ts={contents.asOf} /></>}
      </p>
      <EntryNav active="stream" />

      <div className="mt-5 flex items-center gap-5 text-sm">
        <button onClick={() => setFilter(null)}
          className={filter == null ? 'font-medium text-zinc-900' : 'text-zinc-400 transition-colors hover:text-zinc-600'}>
          全部信源
        </button>
        {(creators.data ?? []).map((c) => (
          <button key={c.id} onClick={() => setFilter(filter === c.id ? null : c.id)}
            className={filter === c.id ? 'font-medium text-zinc-900' : 'text-zinc-400 transition-colors hover:text-zinc-600'}>
            {c.name}
          </button>
        ))}
      </div>

      {contents.data == null ? (
        <div className="mt-11">
          {contents.loading ? <Skeleton height={280} />
            : contents.error ? <ErrorState error={contents.error} onRetry={contents.refetch} />
            : <Skeleton height={280} />}
        </div>
      ) : (
        <>
          {byMonth.map(([month, items]) => (
            <section key={month} className="mt-11">
              <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">{month}</h2>
              <div className="mt-3">
                {items.map((c) => (
                  <article key={c.id} onClick={() => navigate(`/knowledge/content/${c.id}`)}
                    className="-mx-4 cursor-pointer rounded-xl px-4 py-4 transition-colors duration-150 hover:bg-zinc-50">
                    <h3 className="text-md font-medium leading-snug text-zinc-900">{c.title ?? '—'}</h3>
                    <p className="mt-1.5 text-xs text-zinc-400">
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
                        <span className="ml-2 font-mono text-2xs">
                          {c.n_hit > 0 && <span className="text-verdict-hit">{c.n_hit}✓</span>}
                          {c.n_partial > 0 && <span className="ml-1 text-verdict-partial">{c.n_partial}½</span>}
                          {c.n_miss > 0 && <span className="ml-1 text-verdict-miss">{c.n_miss}✗</span>}
                        </span>
                      )}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {shown.length === 0 && (
            <p className="mt-16 text-base text-zinc-400">还没有内容。用 backfill_transcripts 抓取信源的近期视频。</p>
          )}
        </>
      )}
    </Shell>
  )
}

export default function Knowledge({ route }: { route: Route }) {
  if (route.path[1] === 'content' && route.path[2]) return <Reading id={Number(route.path[2])} />
  if (route.path[1] === 'unit' && route.path[2]) return <KnowledgeUnit id={Number(route.path[2])} />
  if (route.path[1] === 'browse') return <Browse route={route} />
  if (route.path[1] === 'tags') return <TagsIndex />
  return <Stream route={route} />
}
