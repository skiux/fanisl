import { useMemo } from 'react'
import {
  fetchCollectionStatus, fetchKnowledgeContents, fetchKnowledgeRecentScores,
  fetchKnowledgeScoreboard,
} from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate } from '../../lib/router'
import { AsOf, ErrorState, QueryGate, ScoreBadge, Skeleton } from '../ui'
import { unitHeadline } from '../knowledgeUnits'

// 今日（前门，PRODUCT.md §3）：回答"我离开的这段时间，机器学到了什么"。
// 头版=新到期评分（每天真正的新闻是判决），次之=新入库内容；侧栏=信源战绩+系统脉搏。

const dayKey = (s: string) => {
  const d = new Date(s)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function groupByDay<T>(items: T[], key: (x: T) => string | null): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    const day = dayKey(k)
    if (!m.has(day)) m.set(day, [])
    m.get(day)!.push(it)
  }
  return [...m.entries()]
}

export default function Today() {
  const scores = useQuery(() => fetchKnowledgeRecentScores(7, 200), [], { pollMs: 60000 })
  const contents = useQuery(() => fetchKnowledgeContents(), [], { pollMs: 60000 })
  const board = useQuery(() => fetchKnowledgeScoreboard(), [], { pollMs: 60000 })
  const status = useQuery(() => fetchCollectionStatus(), [], { pollMs: 60000 })

  const scoreDays = useMemo(
    () => groupByDay(scores.data ?? [], (s: any) => s.scored_at),
    [scores.data])

  const recentContents = useMemo(() => {
    const list = (contents.data ?? [])
      .filter((c) => c.published_at && Date.now() - new Date(c.published_at).getTime() < 7 * 86400000)
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    return groupByDay(list, (c: any) => c.published_at)
  }, [contents.data])

  const latest = useMemo(() => {
    const list = [...(contents.data ?? [])].filter((c) => c.published_at)
    list.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    return list[0]
  }, [contents.data])

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto grid max-w-[68rem] gap-x-20 gap-y-12 px-6 pb-28 pt-12 xl:grid-cols-[minmax(0,44rem)_15rem] xl:justify-center">
        <main className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">今日</h1>
          <p className="mt-2.5 text-sm text-zinc-400">
            近 7 天的判决与知识增量。<AsOf ts={scores.asOf} prefix="本页截至" />
          </p>

          {/* ① 新到期评分：判决是每天的新闻 */}
          <section className="mt-11">
            <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              到期评分{scores.data != null && ` · ${scores.data.length}`}
            </h2>
            {scores.data == null ? (
              <div className="mt-4">
                {scores.loading ? <Skeleton height={160} />
                  : scores.error ? <ErrorState error={scores.error} onRetry={scores.refetch} />
                  : <Skeleton height={160} />}
              </div>
            ) : scores.data.length === 0 ? (
              <p className="mt-4 text-base text-zinc-400">
                近 7 天没有到期评分。评分器按天跑（scorers CLI），claim 到期自动落库。
              </p>
            ) : (
              scoreDays.map(([day, items]) => (
                <div key={day} className="mt-6 first:mt-4">
                  <h3 className="font-mono text-2xs text-zinc-300">{day}</h3>
                  <div className="mt-1.5">
                    {items.map((s: any) => (
                      <button key={s.id} onClick={() => navigate(`/knowledge/unit/${s.unit_id}`)}
                        className="-mx-4 flex w-[calc(100%+2rem)] flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-xl px-4 py-2 text-left transition-colors duration-150 hover:bg-zinc-50">
                        <ScoreBadge horizonLabel={s.horizon_label} outcome={s.outcome}
                          evalClose={s.realized?.eval_close} />
                        <span className="min-w-0 text-md font-medium leading-snug text-zinc-900">
                          {unitHeadline(s)}
                        </span>
                        <span className="text-xs text-zinc-400">{s.creator}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ② 新内容 */}
          <section className="mt-14">
            <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">新内容</h2>
            {contents.data == null ? (
              <div className="mt-4">
                {contents.loading ? <Skeleton height={140} />
                  : contents.error ? <ErrorState error={contents.error} onRetry={contents.refetch} />
                  : <Skeleton height={140} />}
              </div>
            ) : recentContents.length === 0 ? (
              <div className="mt-4 text-base text-zinc-400">
                <p>过去 7 天没有新内容入库。</p>
                {latest && (
                  <p className="mt-2 text-sm">
                    最近一篇是 {dayKey(latest.published_at)} 的
                    <button onClick={() => navigate(`/knowledge/content/${latest.id}`)}
                      className="mx-1 text-zinc-600 underline decoration-zinc-300 transition-colors hover:decoration-zinc-500">
                      {latest.title ?? `内容 #${latest.id}`}
                    </button>
                    。抓取新视频用 backfill_transcripts。
                  </p>
                )}
              </div>
            ) : (
              recentContents.map(([day, items]) => (
                <div key={day} className="mt-6 first:mt-4">
                  <h3 className="font-mono text-2xs text-zinc-300">{day}</h3>
                  <div className="mt-1">
                    {items.map((c: any) => (
                      <article key={c.id} onClick={() => navigate(`/knowledge/content/${c.id}`)}
                        className="-mx-4 cursor-pointer rounded-xl px-4 py-3 transition-colors duration-150 hover:bg-zinc-50">
                        <h4 className="text-md font-medium leading-snug text-zinc-900">{c.title ?? '—'}</h4>
                        <p className="mt-1 text-xs text-zinc-400">
                          {c.creator}
                          {c.n_units > 0 && (
                            <> · {[
                              c.n_claims > 0 ? `${c.n_claims} 判断` : null,
                              c.n_methods > 0 ? `${c.n_methods} 方法` : null,
                              c.n_concepts > 0 ? `${c.n_concepts} 认知` : null,
                            ].filter(Boolean).join('，')}</>
                          )}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </main>

        <aside className="min-w-0 xl:pt-24">
          <div className="space-y-10 text-xs leading-relaxed xl:sticky xl:top-12">
            <div>
              <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-300">信源战绩</h2>
              <QueryGate q={board} skeletonHeight={120}>
                {(rows) => (
                  <div className="mt-3 space-y-4">
                    {rows.map((b: any) => (
                      <div key={b.creator_id}>
                        <button onClick={() => navigate(`/knowledge?creator=${b.creator_id}`)}
                          className="font-medium text-zinc-700 transition-colors hover:text-zinc-900">
                          {b.name}
                        </button>
                        <div className="mt-0.5 text-zinc-400">
                          {b.hit_rate != null && <>命中率 <span className="font-mono">{(b.hit_rate * 100).toFixed(0)}%</span> ({b.scored})<span className="mx-1 text-zinc-300">·</span></>}
                          含糊率 {b.vague_rate != null ? <span className="font-mono">{(b.vague_rate * 100).toFixed(0)}%</span> : '—'}
                        </div>
                      </div>
                    ))}
                    {rows.length === 0 && <p className="mt-3 text-zinc-400">还没有信源。用 register CLI 登记。</p>}
                  </div>
                )}
              </QueryGate>
            </div>

            <div>
              <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-300">系统脉搏</h2>
              <QueryGate q={status} skeletonHeight={100}>
                {(s) => (
                  <div className="mt-3 space-y-2">
                    {!s.enabled && <p className="text-verdict-partial">采集器未启用。</p>}
                    {s.runs.map((r) => (
                      <div key={r.job} className="flex items-baseline gap-2">
                        <span className={`shrink-0 ${r.ok ? 'text-zinc-500' : 'text-verdict-miss'}`}>
                          {r.ok ? '✓' : '✗'}
                        </span>
                        <span className="min-w-0">
                          <span className="text-zinc-600">{r.job}</span>
                          <span className="ml-1.5 font-mono text-2xs text-zinc-400">
                            <AsOf ts={r.started_at} prefix="" staleAfterMin={r.job === 'market' ? 60 : 26 * 60} />
                          </span>
                          {!r.ok && r.note && <span className="ml-1 text-verdict-miss">{r.note}</span>}
                        </span>
                      </div>
                    ))}
                    {s.runs.length === 0 && <p className="text-zinc-400">还没有采集记录。worker_collector 运行后出现。</p>}
                    <p className="pt-1 text-2xs text-zinc-300">知识验证按天跑：prices → scorers 两条幂等 CLI。</p>
                  </div>
                )}
              </QueryGate>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
