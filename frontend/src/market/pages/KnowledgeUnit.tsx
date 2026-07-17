import { useMemo } from 'react'
import { ArrowLeft, ArrowSquareOut } from '@phosphor-icons/react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fetchKnowledgePrices, fetchKnowledgeUnit } from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate } from '../../lib/router'
import { CHART, ErrorState, OUTCOME_BADGE, QueryGate, Quote, ScoreBadge, Skeleton } from '../ui'
import {
  ClaimMetaLine, GRADE_CLS, KIND_LABEL, Lifeline, fmtShortDate, realizedText, unitHeadline,
} from '../knowledgeUnits'

// 单元详情页（Reading 容器）：证据链的下钻落点——
// 结论 → 口径（冻结 ScoringSpec 全文）→ 生命线 → 证据图（daily_bars 叠加判决）→ 评分明细 → 出处。

const fmtDay = (d: Date) => d.toISOString().slice(0, 10)

export default function KnowledgeUnit({ id }: { id: number }) {
  const q = useQuery(() => fetchKnowledgeUnit(id), [id])
  const u = q.data
  const p = u?.payload ?? {}
  const spec = p.scoring_spec
  const ladder: string[] = spec?.eval_ladder ?? []

  // 证据图窗口：发布前 7 天 → max(阶梯末端, 今天) + 2 天
  const win = useMemo(() => {
    if (!u?.published_at) return null
    const pub = new Date(u.published_at)
    const since = new Date(pub.getTime() - 7 * 86400000)
    const last = ladder.length ? new Date(ladder[ladder.length - 1]) : new Date()
    const until = new Date(Math.max(last.getTime(), Date.now()) + 2 * 86400000)
    return { since: fmtDay(since), until: fmtDay(until) }
  }, [u?.published_at, ladder.join(',')])

  const symbol: string | null = u?.kind === 'claim' ? (p.asset_symbol ?? null) : null
  const prices = useQuery(
    async () => (symbol && win ? fetchKnowledgePrices(symbol, win.since, win.until) : null),
    [symbol, win?.since, win?.until],
  )
  const bars = prices.data?.bars ?? []
  const pts = useMemo(() => bars.map((b) => ({ t: new Date(b.ts).getTime(), close: b.close })), [bars])

  const scores: any[] = u?.scores ?? []
  const scoredByLabel = Object.fromEntries(scores.map((s: any) => [s.horizon_label, s]))

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[44rem] px-6 pb-28 pt-10">
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <button onClick={() => navigate('/knowledge')}
            className="flex items-center gap-1.5 transition-colors hover:text-zinc-700">
            <ArrowLeft size={14} /> 知识库
          </button>
          {u?.content_url && (
            <a href={u.content_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-zinc-700">
              原视频 <ArrowSquareOut size={13} />
            </a>
          )}
        </div>

        <QueryGate q={q} skeletonHeight={320}>
          {(unit) => (
            <>
              <p className="mt-8 text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                {KIND_LABEL[unit.kind]}{unit.kind === 'claim' && p.claim_class ? ` · ${p.claim_class}` : ''}
              </p>
              <h1 className="mt-2 text-2xl font-semibold leading-snug tracking-tight text-zinc-900">
                {unitHeadline(unit)}
              </h1>
              <p className="mt-3 text-sm text-zinc-400">
                {unit.kind === 'claim' && <><ClaimMetaLine p={p} refPrice={unit.ref_price_at_publish} /> · </>}
                {unit.creator} · {fmtShortDate(unit.published_at)} ·{' '}
                <button onClick={() => navigate(`/knowledge/content/${unit.content_id}`)}
                  className="underline decoration-zinc-200 transition-colors duration-150 hover:text-zinc-600 hover:decoration-zinc-400">
                  {unit.content_title ?? `内容 #${unit.content_id}`}
                </button>
              </p>

              <div className="mt-8">
                <Quote locator={unit.locator}>{unit.quote}</Quote>
              </div>

              {unit.kind === 'claim' && p.condition_text && (
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                  前置条件：{p.condition_text}{!p.condition_observable && '（不可机械判定）'}
                </p>
              )}
              {unit.kind === 'method' && (p.rules ?? []).length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-600">
                  {p.rules.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              )}

              {/* 生命线：发布 → 评估阶梯 → 今 */}
              {unit.kind === 'claim' && unit.published_at && ladder.length > 0 && (
                <section className="mt-12">
                  <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">生命线</h2>
                  <div className="mt-3">
                    <Lifeline published={unit.published_at} ladder={ladder} scores={scores} />
                  </div>
                </section>
              )}

              {/* 证据图：价格路径 + 基准/目标 + 判决时点（DESIGN.md §8 判决叠加） */}
              {unit.kind === 'claim' && symbol && (
                <section className="mt-10">
                  <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                    证据 · {symbol} 日线
                  </h2>
                  {prices.data == null ? (
                    prices.loading ? <div className="mt-3"><Skeleton height={220} /></div>
                      : prices.error ? <div className="mt-3"><ErrorState error={prices.error} onRetry={prices.refetch} /></div>
                      : null
                  ) : pts.length === 0 ? (
                    <p className="mt-3 text-sm text-zinc-400">
                      该标的暂无日线覆盖（daily_bars 由 prices CLI 按 SYMBOL_MAP 刷新）。
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid stroke={CHART.grid.stroke} vertical={false} />
                            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
                              tickFormatter={(t) => new Date(t).toISOString().slice(5, 10)}
                              tick={CHART.axisTick} tickLine={false} axisLine={CHART.axisLine} minTickGap={56} />
                            <YAxis width={56} domain={['auto', 'auto']} tick={CHART.axisTick}
                              tickFormatter={(v: number) => String(v)} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={CHART.tooltip}
                              labelFormatter={(t) => new Date(t as number).toISOString().slice(0, 10)}
                              formatter={(v: number) => [v, '收盘']} />
                            {/* 发布时点 */}
                            <ReferenceLine x={new Date(unit.published_at).getTime()} stroke="#a1a1aa" strokeDasharray="4 4"
                              label={{ value: '发布', position: 'insideTopLeft', fontSize: 11, fill: '#71717a' }} />
                            {/* 基准价（发布参考价） */}
                            {unit.ref_price_at_publish != null && (
                              <ReferenceLine y={unit.ref_price_at_publish} stroke="#a1a1aa" strokeDasharray="4 4"
                                label={{ value: `基准 ${unit.ref_price_at_publish}`, position: 'insideBottomLeft', fontSize: 11, fill: '#71717a' }} />
                            )}
                            {/* 目标/区间线 */}
                            {p.magnitude?.target != null && (
                              <ReferenceLine y={p.magnitude.target} stroke="#3f3f46" strokeDasharray="6 3"
                                label={{ value: `目标 ${p.magnitude.target}`, position: 'insideTopRight', fontSize: 11, fill: '#3f3f46' }} />
                            )}
                            {p.magnitude?.low != null && (
                              <ReferenceLine y={p.magnitude.low} stroke="#3f3f46" strokeDasharray="6 3"
                                label={{ value: `${p.magnitude.high != null ? '下沿' : '守'} ${p.magnitude.low}`, position: 'insideBottomRight', fontSize: 11, fill: '#3f3f46' }} />
                            )}
                            {p.magnitude?.high != null && (
                              <ReferenceLine y={p.magnitude.high} stroke="#3f3f46" strokeDasharray="6 3"
                                label={{ value: `${p.magnitude.low != null ? '上沿' : '压'} ${p.magnitude.high}`, position: 'insideTopRight', fontSize: 11, fill: '#3f3f46' }} />
                            )}
                            {/* 评估时点：已判决=判决色实线，未到期=灰虚线 */}
                            {ladder.map((d) => {
                              const s = scoredByLabel[d]
                              const color = s ? ({ hit: '#059669', partial: '#d97706', miss: '#f43f5e' } as any)[s.outcome] ?? '#a1a1aa' : '#d4d4d8'
                              return (
                                <ReferenceLine key={d} x={new Date(d).getTime()} stroke={color}
                                  strokeDasharray={s ? undefined : '3 3'}
                                  label={{ value: d.slice(5), position: 'insideTop', fontSize: 11, fill: color }} />
                              )
                            })}
                            <Line type="monotone" dataKey="close" stroke={CHART.seriesMain} strokeWidth={1.4}
                              dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-1.5 text-2xs text-zinc-400">
                        {prices.data.note && <>{symbol}：{prices.data.note} · </>}
                        窗口 {win?.since} ~ {win?.until} · 评估线：实线=已判决（判决色），虚线=未到期
                      </p>
                    </>
                  )}
                </section>
              )}

              {/* 评分明细 */}
              {unit.kind === 'claim' && (
                <section className="mt-10">
                  <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                    评分 · {scores.length}/{ladder.length} 时点
                  </h2>
                  {scores.length === 0 ? (
                    <p className="mt-3 text-sm text-zinc-400">
                      {p.verifiability === 'D'
                        ? 'D 级（不可评）：不带评分规格，含糊率本身是信源指标。'
                        : ladder.length
                          ? '尚无到期时点。评分器按天跑，到期自动落库。'
                          : '无评估阶梯。'}
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {scores.map((s: any, i: number) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                          <ScoreBadge horizonLabel={s.horizon_label} outcome={s.outcome} evalClose={s.realized?.eval_close} />
                          <span className="text-zinc-500">{OUTCOME_BADGE[s.outcome]?.label ?? s.outcome}</span>
                          <span className="font-mono text-xs text-zinc-500">{realizedText(s.realized)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* 冻结口径 */}
              {spec && (
                <section className="mt-10 border-t border-zinc-100 pt-8">
                  <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                    冻结评分规格（提取时一次性冻结，评分器机械执行）
                  </h2>
                  <p className="mt-3 text-xs text-zinc-400">
                    方法 <span className="font-mono text-zinc-600">{spec.method}</span>
                    {spec.benchmark && <> · 基准 <span className="font-mono text-zinc-600">{spec.benchmark}</span></>}
                    {' '}· 阶梯 <span className="font-mono text-zinc-600">{ladder.join(' / ')}</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{spec.success_def}</p>
                </section>
              )}

              {/* 标签 */}
              {(unit.tags ?? []).length > 0 && (
                <p className="mt-10 text-xs text-zinc-400">
                  标签：
                  {unit.tags.map((t: string) => (
                    <button key={t} onClick={() => navigate(`/knowledge/browse?tag=${encodeURIComponent(t)}`)}
                      className="ml-2 font-mono underline decoration-zinc-200 transition-colors duration-150 hover:text-zinc-600 hover:decoration-zinc-400">
                      {t}
                    </button>
                  ))}
                </p>
              )}

              <p className="mt-6 text-2xs text-zinc-300">
                提取 {unit.extractor_version} · 单元 #{unit.id}
                {unit.kind === 'claim' && p.verifiability && ` · ${p.verifiability} 级`}
              </p>
            </>
          )}
        </QueryGate>
      </div>
    </div>
  )
}
