import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaretLeft, XCircle } from '@phosphor-icons/react'
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cancelTrade, fetchTradeTimeline } from '../../api'
import { Badge, ChartSkeleton, EmptyState, Panel, SegTabs } from '../ui'
import { fmtNum } from '../format'
import {
  dur, num, pct, rr, sym, signedUsd, usd, when, whenSec,
  ADJ_ACTION, EVENT_KIND, EXIT_REASON, ORDER_KIND, OUTCOME, REGIME, SIDE, SKILL_LUCK, STATUS, STRATEGY, WAKE,
} from '../trading'

function downsample<T>(arr: T[], n = 600): T[] {
  if (arr.length <= n) return arr
  const step = (arr.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)])
}

// 单笔交易的独立详情页：决策依据 → 过程（走势/管理/事件）→ 结果 → 复盘
export default function TradeDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [tl, setTl] = useState<any>(null)
  const [mode, setMode] = useState<'price' | 'upnl'>('price')

  const load = useCallback(() => fetchTradeTimeline(id).then(setTl).catch(() => {}), [id])
  useEffect(() => { setTl(null); load() }, [id, load])
  // 未平仓时跟着盯市刷新
  const live = tl?.trade?.status === 'open' || tl?.trade?.status === 'planned'
  useEffect(() => {
    if (!live) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [live, load])

  const t = tl?.trade
  const plans = tl?.plans ?? []
  const v1 = plans[0]?.plan
  const active = (plans.find((p: any) => p.is_active) ?? plans[plans.length - 1])?.plan
  const result = tl?.result
  const review = tl?.review?.review
  const orders = tl?.orders ?? []
  const events = tl?.events ?? []

  const pts = useMemo<{ t: number; mark: number | null; upnl: number | null }[]>(
    () => downsample((tl?.snapshots ?? []).map((s: any) => ({
      t: new Date(s.ts).getTime(), mark: s.mark, upnl: s.upnl,
    }))),
    [tl?.snapshots],
  )

  // 价格图的纵轴范围要把进场/止损/止盈参考线都纳入
  const priceDomain = useMemo(() => {
    if (pts.length === 0) return undefined
    const vals = pts.map((p: any) => p.mark).filter((v: any) => v != null)
    if (t?.avg_entry) vals.push(t.avg_entry)
    if (active?.sl_price) vals.push(active.sl_price)
    for (const tp of active?.tp_targets ?? []) if (tp?.price) vals.push(tp.price)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const pad = (hi - lo) * 0.06 || hi * 0.001
    return [lo - pad, hi + pad] as [number, number]
  }, [pts, t?.avg_entry, active])

  const upnlEnd = (pts.length ? pts[pts.length - 1].upnl : 0) ?? 0

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-zinc-50">
      {/* 详情页固定页头：返回 + 身份 + 结果速览 */}
      <div className="shrink-0 border-b border-zinc-200/60 px-5 py-3">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
          <button onClick={onBack}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px">
            <CaretLeft size={13} weight="bold" /> 返回
          </button>
          <div className="h-5 w-px bg-zinc-200" />
          {t ? (
            <>
              <span className="font-mono text-[13px] text-zinc-400">#{t.id}</span>
              <span className="text-[15px] font-semibold tracking-tight text-zinc-900">{sym(t.symbol)}</span>
              <Badge tone={t.side === 'long' ? 'accent' : 'neutral'}>{SIDE[t.side] ?? t.side} {num(t.leverage, 0)}x</Badge>
              <Badge tone={t.status === 'open' ? 'accent' : 'neutral'}>{STATUS[t.status] ?? t.status}</Badge>
              {t.setup_key
                ? <Badge tone="accent">setup · {t.setup_key}</Badge>
                : <span className="text-[12px] text-zinc-400">{STRATEGY[t.strategy_type] ?? t.strategy_type}</span>}
              {t.status === 'planned' && (
                <button onClick={() => cancelTrade(t.id).then(load).catch(() => {})}
                  className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-100 active:translate-y-px">
                  <XCircle size={13} weight="bold" /> 撤单
                </button>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                {result ? (
                  <>
                    <span className={`font-mono text-[14px] font-medium tabular-nums ${result.pnl_abs > 0 ? 'text-emerald-600' : result.pnl_abs < 0 ? 'text-rose-600' : 'text-zinc-700'}`}>
                      {signedUsd(result.pnl_abs)}
                    </span>
                    <span className="font-mono text-[12px] text-zinc-500">{rr(result.realized_r)}</span>
                    <span className="text-[12px] text-zinc-400">{EXIT_REASON[result.exit_reason] ?? result.exit_reason}</span>
                    <Badge tone={result.outcome === 'win' ? 'accent' : result.outcome === 'loss' ? 'high' : 'neutral'}>{OUTCOME[result.outcome] ?? result.outcome}</Badge>
                  </>
                ) : live && pts.length > 0 ? (
                  <span className={`font-mono text-[14px] font-medium tabular-nums ${upnlEnd > 0 ? 'text-emerald-600' : upnlEnd < 0 ? 'text-rose-600' : 'text-zinc-700'}`}>
                    浮动 {signedUsd(upnlEnd)}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-[13px] text-zinc-400">加载中…</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-5 py-4">
          {!tl ? (
            <ChartSkeleton height={360} />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              {/* 左：过程 */}
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-3">
                <Panel
                  title="持仓走势（盯市快照）"
                  right={<SegTabs size="sm" value={mode} onChange={(v) => setMode(v as 'price' | 'upnl')}
                    options={[{ value: 'price', label: '标记价' }, { value: 'upnl', label: '浮动盈亏' }]} />}
                >
                  {pts.length < 2 ? (
                    <EmptyState title="暂无盯市快照" hint="开仓后引擎每拍记录标记价与浮动盈亏" />
                  ) : (
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="td" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.14} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#f4f4f5" vertical={false} />
                          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
                            tickFormatter={(x) => when(new Date(x).toISOString())}
                            tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false}
                            axisLine={{ stroke: '#e4e4e7' }} minTickGap={56} />
                          <YAxis width={60}
                            domain={mode === 'price' ? priceDomain : ['auto', 'auto']}
                            tick={{ fontSize: 11, fill: '#a1a1aa', fontFamily: 'Geist Mono' }}
                            tickFormatter={(v) => fmtNum(v)} tickLine={false} axisLine={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, fontFamily: 'Geist Mono' }}
                            labelFormatter={(x) => whenSec(new Date(x as number).toISOString())}
                            formatter={(v: number) => (mode === 'price' ? [fmtNum(v), '标记价'] : [signedUsd(v), '浮动盈亏'])} />
                          {mode === 'price' ? (
                            <>
                              {t?.avg_entry > 0 && <ReferenceLine y={t.avg_entry} stroke="#a1a1aa" strokeDasharray="4 4"
                                label={{ value: `进场 ${fmtNum(t.avg_entry)}`, position: 'insideTopLeft', fontSize: 10, fill: '#71717a' }} />}
                              {active?.sl_price && <ReferenceLine y={active.sl_price} stroke="#f43f5e" strokeDasharray="4 4"
                                label={{ value: `止损 ${fmtNum(active.sl_price)}`, position: 'insideBottomLeft', fontSize: 10, fill: '#e11d48' }} />}
                              {(active?.tp_targets ?? []).map((tp: any, i: number) => tp?.price && (
                                <ReferenceLine key={i} y={tp.price} stroke="#10b981" strokeDasharray="4 4"
                                  label={{ value: `止盈${(active?.tp_targets ?? []).length > 1 ? i + 1 : ''} ${fmtNum(tp.price)}`, position: 'insideTopRight', fontSize: 10, fill: '#059669' }} />
                              ))}
                              <Area type="monotone" dataKey="mark" stroke="#3f3f46" strokeWidth={1.4} fill="none" />
                            </>
                          ) : (
                            <>
                              <ReferenceLine y={0} stroke="#d4d4d8" />
                              <Area type="monotone" dataKey="upnl" stroke="#10b981" strokeWidth={1.4} fill="url(#td)" />
                            </>
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-400">
                    <span>快照 {(tl.snapshots ?? []).length.toLocaleString()} 帧</span>
                    <span>开仓 {when(t?.opened_at)}</span>
                    {t?.closed_at && <span>平仓 {when(t.closed_at)}</span>}
                    {result && <span>持仓 {dur(result.holding_s)}</span>}
                  </div>
                </Panel>

                {/* 决策依据（v1 原始计划）——setup 交易由模板确定性生成，酌情分析字段为空 */}
                {v1 && (
                  <Panel title={v1.setup_key ? 'Setup 模板计划（规则生成 · Claude 仅闸门）' : '决策依据（开仓时的原始计划）'}
                    right={v1.confidence_pct != null ? <Badge>置信 {v1.confidence_pct}%</Badge> : undefined}>
                    <blockquote className="rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
                      {v1.thesis}
                    </blockquote>
                    <div className="mt-3 grid grid-cols-2 gap-x-8 sm:grid-cols-3">
                      <Row k="策略" v={STRATEGY[v1.strategy_type] ?? v1.strategy_type} />
                      <Row k="市场环境" v={REGIME[v1.regime] ?? v1.regime} />
                      <Row k="进场" v={`${v1.entry_type === 'limit' ? '限价' : '市价'} @ ${num(v1.entry_price)}`} />
                      <Row k="止损" v={`${num(v1.sl_price)}（${v1.sl_basis ?? '—'}）`} />
                      <Row k="止盈" v={(v1.tp_targets || []).map((x: any) => `${num(x.price)} (${x.reduce_pct}%)`).join(' · ') || '—'} />
                      <Row k="计划盈亏比" v={num(v1.computed?.rr)} />
                      <Row k="风险" v={pct(v1.risk_pct)} />
                      <Row k="数量 / 保证金" v={`${num(v1.computed?.qty, 4)} / ${usd(v1.computed?.margin)}`} />
                      <Row k="强平价" v={num(v1.computed?.liquidation_price)} />
                    </div>
                    {(v1.mtf || v1.macro_context || v1.risk_events || v1.risk_appetite || v1.notes) && (
                      <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 text-[12.5px] leading-relaxed text-zinc-600">
                        {v1.mtf && (
                          <p>
                            <span className="text-zinc-400">多周期：</span>
                            {v1.mtf.aligned ? '三周期共振' : '未共振'}
                            <span className="ml-2 font-mono text-[11.5px] text-zinc-500">
                              大 {v1.mtf.higher_tf} · 中 {v1.mtf.trading_tf} · 入 {v1.mtf.entry_tf}
                            </span>
                          </p>
                        )}
                        {v1.macro_context && <p><span className="text-zinc-400">宏观：</span>{v1.macro_context}</p>}
                        {v1.risk_events && <p><span className="text-zinc-400">风险事件：</span>{v1.risk_events}</p>}
                        {v1.risk_appetite && <p><span className="text-zinc-400">风险偏好：</span>{v1.risk_appetite}</p>}
                        {v1.notes && <p><span className="text-zinc-400">备注：</span>{v1.notes}</p>}
                      </div>
                    )}
                    {v1.time_exit_hours != null && (
                      <p className="mt-2 text-[12px] text-zinc-400">到时平仓：持仓 {v1.time_exit_hours}h 引擎确定性退出（setup 主要出场方式）</p>
                    )}
                  </Panel>
                )}

                {/* 持仓管理：计划版本演变 */}
                {plans.length > 1 && (
                  <Panel title={`持仓管理 · ${plans.length - 1} 次调整`}>
                    <ul className="divide-y divide-zinc-100">
                      {plans.slice(1).map((p: any) => (
                        <li key={p.version} className="py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-zinc-400">v{p.version}</span>
                            <Badge tone={p.plan?.adjustment?.action === 'close' ? 'high' : 'neutral'}>
                              {ADJ_ACTION[p.plan?.adjustment?.action] ?? p.plan?.adjustment?.action ?? '调整'}
                            </Badge>
                            {p.plan?.sl_price != null && (
                              <span className="font-mono text-[11.5px] text-zinc-500">止损 → {num(p.plan.sl_price)}</span>
                            )}
                            <span className="ml-auto font-mono text-[11px] text-zinc-400">{when(p.created_at)}</span>
                          </div>
                          {p.plan?.adjustment?.reason && (
                            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600">{p.plan.adjustment.reason}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}

                {/* 事件时间线 */}
                <Panel title={`事件时间线 · ${events.length}`}>
                  {events.length === 0 ? <EmptyState title="暂无事件" /> : (
                    <ul className="divide-y divide-zinc-100">
                      {events.map((e: any) => (
                        <li key={e.id ?? `${e.ts}-${e.kind}`} className="flex items-baseline gap-3 py-1.5 text-[12.5px] first:pt-0 last:pb-0">
                          <span className="w-[88px] shrink-0 font-mono text-[11px] text-zinc-400">{whenSec(e.ts)}</span>
                          <span className={`shrink-0 font-medium ${e.actor === 'claude' ? 'text-emerald-700' : 'text-zinc-700'}`}>
                            {EVENT_KIND[e.kind] ?? e.kind}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-500" title={eventInfo(e)}>{eventInfo(e)}</span>
                          <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-zinc-300">{e.actor}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              {/* 右：结论 */}
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
                {result && (
                  <Panel title="结果（引擎客观核算）">
                    <div className="grid grid-cols-2 gap-x-6">
                      <Row k="盈亏" v={signedUsd(result.pnl_abs)} tone={result.pnl_abs > 0 ? 'up' : result.pnl_abs < 0 ? 'down' : undefined} />
                      <Row k="盈亏 %（对保证金）" v={`${result.pnl_pct >= 0 ? '+' : ''}${pct(result.pnl_pct)}`} tone={result.pnl_abs > 0 ? 'up' : 'down'} />
                      <Row k="实际 R / 计划 R" v={`${num(result.realized_r)} / ${num(result.planned_r)}`} />
                      <Row k="出场原因" v={EXIT_REASON[result.exit_reason] ?? result.exit_reason} />
                      <Row k="结果" v={OUTCOME[result.outcome] ?? result.outcome} tone={result.outcome === 'win' ? 'up' : result.outcome === 'loss' ? 'down' : undefined} />
                      <Row k="持仓 / 手续费" v={`${dur(result.holding_s)} / ${usd(result.fees)}`} />
                    </div>
                    {(result.mfe_r != null || result.counterfactual_r != null || result.bh_r != null) && (
                      <div className="mt-2 grid grid-cols-2 gap-x-6 border-t border-zinc-100 pt-2">
                        <Row k="MFE / MAE" v={`${rr(result.mfe_r)} / ${rr(result.mae_r)}`} />
                        <Row k="出场效率" v={result.exit_efficiency != null ? `${(result.exit_efficiency * 100).toFixed(0)}%` : '—'} />
                        <Row k="不管理基准 R" v={rr(result.counterfactual_r)} />
                        <Row k="管理层贡献" v={rr(result.mgmt_contribution_r)}
                          tone={(result.mgmt_contribution_r ?? 0) > 0 ? 'up' : (result.mgmt_contribution_r ?? 0) < 0 ? 'down' : undefined} />
                        <Row k="买入持有基准 R（同窗口）" v={rr(result.bh_r)} />
                      </div>
                    )}
                  </Panel>
                )}

                {review && (
                  <Panel title="复盘（Claude 自评）"
                    right={<Badge tone={review.skill_vs_luck?.startsWith('right') ? 'accent' : 'high'}>{SKILL_LUCK[review.skill_vs_luck] ?? review.skill_vs_luck}</Badge>}>
                    <div className="space-y-2 text-[13px] leading-relaxed text-zinc-600">
                      {review.skill_vs_luck_note && <p className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-700">{review.skill_vs_luck_note}</p>}
                      <p><span className="text-zinc-400">纪律：</span>{review.plan_adherence}</p>
                      {(review.discipline_violations || []).length > 0 && (
                        <p className="text-rose-600">违规：{review.discipline_violations.join('；')}</p>
                      )}
                      <p><span className="text-zinc-400">进场时机：</span>{review.entry_timing}</p>
                      <p><span className="text-zinc-400">出场时机：</span>{review.exit_timing}</p>
                      <p><span className="text-zinc-400">改进：</span>{review.lessons}</p>
                    </div>
                  </Panel>
                )}

                {(active?.wake_conditions ?? []).length > 0 && (
                  <Panel title="唤醒条件（Claude 声明 · 引擎确定性监测）">
                    <ul className="space-y-2">
                      {(active.wake_conditions as any[]).map((w, i) => (
                        <li key={i} className="text-[12.5px] leading-relaxed">
                          <span className="mr-2 inline-block rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600">
                            {WAKE[w.type] ?? w.type} {w.value}
                          </span>
                          <span className="text-zinc-500">{w.note}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}

                <Panel title={`委托记录 · ${orders.length}`}>
                  {orders.length === 0 ? <EmptyState title="暂无委托" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                            <th className="py-1.5 pr-3 font-medium">类型</th>
                            <th className="py-1.5 pr-3 text-right font-medium">价格</th>
                            <th className="py-1.5 pr-3 text-right font-medium">数量</th>
                            <th className="py-1.5 pr-3 text-right font-medium">手续费</th>
                            <th className="py-1.5 text-right font-medium">时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 font-mono">
                          {orders.map((o: any) => (
                            <tr key={o.id} className="text-zinc-700">
                              <td className="py-1.5 pr-3 font-sans">
                                <span className="font-medium text-zinc-700">{ORDER_KIND[o.kind] ?? o.kind}</span>
                                {o.status !== 'filled' && <span className="ml-1.5 text-[11px] text-zinc-400">{o.status}</span>}
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{num(o.price)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500">{num(o.qty, 4)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500">{num(o.fee)}</td>
                              <td className="py-1.5 text-right text-[11px] tabular-nums text-zinc-400">{when(o.filled_at ?? o.placed_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  const c = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-zinc-800'
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[12px] text-zinc-400">{k}</span>
      <span className={`min-w-0 truncate text-right font-mono text-[13px] tabular-nums ${c}`} title={v}>{v}</span>
    </div>
  )
}

// 事件 payload → 一行摘要
function eventInfo(e: any): string {
  const p = e.payload || {}
  const bits: string[] = []
  if (p.price != null) bits.push(`@ ${num(p.price)}`)
  if (p.mark != null) bits.push(`标记 ${num(p.mark)}`)
  if (p.qty != null) bits.push(`数量 ${num(p.qty, 4)}`)
  if (p.pnl != null) bits.push(`盈亏 ${signedUsd(p.pnl)}`)
  if (p.margin != null) bits.push(`保证金 ${usd(p.margin)}`)
  if (p.reason) bits.push(EXIT_REASON[p.reason] ?? String(p.reason))
  if (Array.isArray(p.reasons)) bits.push(p.reasons.join('；'))
  if (Array.isArray(p.issues)) bits.push(p.issues.join('；'))
  if (Array.isArray(p.flags)) bits.push(p.flags.join('；'))
  if (p.error) bits.push(String(p.error))
  return bits.join(' · ')
}
