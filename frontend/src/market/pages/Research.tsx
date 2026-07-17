import { useMemo, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  detectSetups, fetchDeclines, fetchPositions, fetchTrades, fetchTradingAccount,
  fetchTradingAccounts, fetchTradingSymbols, manualClose, openTrade, scanTrading,
  setForceTrade, tickTrading,
} from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate, type Route } from '../../lib/router'
import {
  AsOf, Badge, CHART, EmptyState, PageShell, Panel, QueryGate, SegTabs, Select, Statline,
  type StatItem,
} from '../ui'
import { fmtNum } from '../format'
import { dur, num, pct, rr, sym, signedUsd, usd, when, OUTCOME, SIDE, SKILL_LUCK_SHORT, STATUS, STRATEGY } from '../trading'
import TradeDetail from './TradeDetail'
import SetupsPanel from './SetupsPanel'
import ManualPanel from './ManualPanel'
import ResearchArchive from './ResearchArchive'

// 研究（纪律档案，Instrument 容器）。层级（PRODUCT.md §3）：
// ① setup 计分卡（头版）② 账户概况 Statline ③ 实盘录入（live）④ 持仓+权益 ⑤ 交易记录
// ⑥ 不交易记录 ⑦ 已关闭实验的对照操作（页尾折叠）。

const ACCT_LABEL: Record<string, string> = {
  setups: 'Setup · playbook', live: '实盘镜像',
  main: '酌情 A（已关）', forced: '酌情 B（已关）', main_shadow: '影子',
}
// 账户默认 setups（评测台现役形态）；main/forced 是已关闭实验的对照组
const ACCT_ORDER = ['setups', 'live', 'main', 'forced', 'main_shadow']

export default function Research({ route }: { route: Route }) {
  const acct = route.query.get('account') ?? 'setups'
  const setAcct = (a: string) => navigate(a === 'setups' ? '/research' : `/research?account=${a}`)

  const accounts = useQuery(() => fetchTradingAccounts(), [])
  const symbols = useQuery(() => fetchTradingSymbols(), [])
  const account = useQuery(() => fetchTradingAccount(acct), [acct], { pollMs: 15000 })
  const trades = useQuery(() => fetchTrades(acct), [acct], { pollMs: 15000 })
  const positions = useQuery(() => fetchPositions(acct), [acct], { pollMs: 15000 })
  const declines = useQuery(() => fetchDeclines(acct), [acct], { pollMs: 60000 })

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [setupsKey, setSetupsKey] = useState(0)

  const cur = (accounts.data ?? []).find((a) => a.name === acct)
  const managed = cur?.managed ?? false
  const isManual = cur?.manual ?? false
  const isSetups = cur?.setups ?? false

  const acctOptions = useMemo(() => {
    const list = [...(accounts.data ?? [])]
    list.sort((a, b) => ACCT_ORDER.indexOf(a.name) - ACCT_ORDER.indexOf(b.name))
    return list.map((a) => ({ value: a.name, label: ACCT_LABEL[a.name] ?? a.name }))
  }, [accounts.data])

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true); setMsg(label)
    try {
      setMsg(await fn())
      account.refetch(); trades.refetch(); positions.refetch(); declines.refetch()
    } catch (e: any) { setMsg(`失败：${e.message || e}`) }
    finally { setBusy(false) }
  }

  const onDetect = () => run('探测中：规则求值 → 触发则 Claude 闸门裁决，可能需要 1~2 分钟…', async () => {
    const r = await detectSetups(acct)
    setSetupsKey((k) => k + 1)
    const d = r.detected || []
    if (d.length === 0) return `本轮无触发（冷却/已持仓/信号未变化）；到期 veto 校验 ${(r.vetoes_verified || []).length} 条`
    return d.map((x: any) => `${x.setup}@${x.symbol}: ${x.verdict}${x.trade_id ? ` #${x.trade_id}` : ''}`).join('；')
  })

  const s = account.data?.summary ?? {}
  const sc = account.data?.scorecard ?? {}

  // 权益曲线：按平仓顺序累计已实现盈亏（评测的主曲线）
  const equityPts = useMemo(() => {
    const init = s.initial_balance
    const ts = trades.data ?? []
    if (init == null) return []
    const closed = ts
      .filter((t) => t.status === 'closed' && t.pnl_abs != null && t.closed_at)
      .sort((a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime())
    if (closed.length === 0) return []
    let eq = init
    const start = ts.reduce(
      (m, t) => Math.min(m, new Date(t.created_at ?? t.closed_at).getTime()),
      new Date(closed[0].closed_at).getTime(),
    )
    return [
      { t: start, eq: init },
      ...closed.map((t) => ({ t: new Date(t.closed_at).getTime(), eq: (eq += t.pnl_abs) })),
    ]
  }, [trades.data, s.initial_balance])

  // 单笔详情与档案是独立地址（#/research/trade/:id · #/research/archive[/:name]）
  if (route.path[1] === 'trade' && route.path[2]) {
    return <TradeDetail id={Number(route.path[2])} onBack={() => setAcct(acct)} />
  }
  if (route.path[1] === 'archive') {
    return <ResearchArchive name={route.path[2]} />
  }

  const scStats: StatItem[] = [
    { label: '期望', value: sc.expectancy_r != null ? rr(sc.expectancy_r) : '—',
      tone: (sc.expectancy_r ?? 0) > 0 ? 'hit' : (sc.expectancy_r ?? 0) < 0 ? 'miss' : 'neutral',
      sub: `已平 ${sc.closed_trades ?? 0} 笔`, title: '每笔期望收益（R）——评测台的第一数字' },
    { label: '胜率', value: sc.win_rate != null ? `${(sc.win_rate * 100).toFixed(0)}% (${sc.closed_trades ?? 0})` : '—' },
    { label: '总盈亏', value: signedUsd(sc.total_pnl),
      tone: (sc.total_pnl ?? 0) > 0 ? 'hit' : (sc.total_pnl ?? 0) < 0 ? 'miss' : 'neutral',
      sub: sc.avg_r != null ? `平均 ${rr(sc.avg_r)}` : undefined },
    { label: '盈利因子', value: num(sc.profit_factor) },
    { label: '最大回撤', value: sc.max_drawdown != null ? usd(sc.max_drawdown) : '—' },
    ...(sc.avg_exit_efficiency != null
      ? [{ label: '出场效率', value: `${(sc.avg_exit_efficiency * 100).toFixed(0)}%`, title: '吃到多少有利波动' }] : []),
    ...(sc.total_mgmt_contribution_r != null
      ? [{ label: '管理贡献', value: rr(sc.total_mgmt_contribution_r),
          tone: (sc.total_mgmt_contribution_r > 0 ? 'hit' : 'miss') as StatItem['tone'], title: 'vs 不管理基准' }] : []),
    ...(sc.decline_accuracy
      ? [{ label: '拒绝力', value: `${(sc.decline_accuracy.accuracy * 100).toFixed(0)}% (${sc.decline_accuracy.correct}/${sc.decline_accuracy.verified})` }] : []),
  ]

  return (
    <PageShell
      title="研究"
      sub={
        <>
          按 setup 类型评 edge · 实盘镜像 · 酌情模式已关闭（保留作对照）。
          <button onClick={() => navigate('/research/archive')}
            className="underline decoration-zinc-200 transition-colors duration-150 hover:text-zinc-600 hover:decoration-zinc-400">
            研究档案（23 裁决）›
          </button>
          {' '}<AsOf ts={account.asOf} prefix="本页截至" />
        </>
      }
      controls={acctOptions.length > 1
        ? <SegTabs size="sm" value={acct} onChange={setAcct} options={acctOptions} />
        : undefined}
    >
      {msg && (
        <p className="mb-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-600">{msg}</p>
      )}

      {/* ① 头版：按 setup 评 edge（评测台重定位后的核心视图） */}
      <SetupsPanel account={acct} refreshKey={setupsKey}
        onOpenTrade={(id) => navigate(`/research/trade/${id}${acct !== 'setups' ? `?account=${acct}` : ''}`)}
        manual={isManual}
        onDetect={isSetups ? onDetect : undefined} busy={busy} />

      {/* ② 账户概况：评测结论为主行，账面记账降为注记 */}
      <div className="mt-4">
        <QueryGate q={account} skeletonHeight={64}>
          {() => (
            <>
              <Statline items={scStats} />
              <p className="mt-1.5 text-2xs text-zinc-400">
                权益 <span className="font-mono">{usd(s.equity)}</span>（初始 <span className="font-mono">{usd(s.initial_balance)}</span>）
                · 可用 <span className="font-mono">{usd(s.balance)}</span>
                · 占用保证金 <span className="font-mono">{usd(s.used_margin)}</span>
                · {s.margin_mode === 'cross' ? '全仓' : '逐仓'}
                · 约束：≤3 持仓 · 同向 ≤2 · 总在险 ≤5%
              </p>
              {(sc.calibration?.length ?? 0) > 0 && (
                <p className="mt-1 text-2xs text-zinc-400">
                  置信度校准{' '}
                  {sc.calibration.map((c: any) => (
                    <span key={c.bucket} className="ml-2 font-mono">
                      {c.bucket}: {(c.win_rate * 100).toFixed(0)}%<span className="text-zinc-300">/{c.n}</span>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </QueryGate>
      </div>

      {/* ③ 实盘录入（唯一写入口） */}
      {isManual && (
        <div className="mt-4">
          <ManualPanel account={acct} symbols={symbols.data ?? []}
            onDone={(m) => { setMsg(m); setSetupsKey((k) => k + 1); trades.refetch(); positions.refetch() }} />
        </div>
      )}

      {/* ④ 持仓 + 权益曲线 */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="持仓（引擎 15s 盯市）">
          <QueryGate q={positions} skeletonHeight={140}>
            {(ps) => ps.length === 0 ? (
              <EmptyState title="当前无持仓" hint={isSetups ? 'setup 触发并通过闸门后在此盯市' : isManual ? '录入实盘交易后在此盯市' : '此账户已停用，仅存档'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-zinc-400">
                      {['标的', '方向', '标记价', '均价', '浮动盈亏', '止损', '止盈', '距强平', '时长'].map((h, i) => (
                        <th key={h} className={`py-1.5 pr-3 font-medium ${i >= 2 ? 'text-right' : ''}`}>{h}</th>
                      ))}
                      {isManual && <th className="py-1.5 font-medium" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-mono">
                    {ps.map((p: any) => {
                      const tp = (p.tp_targets || [])[0]?.price
                      return (
                        <tr key={p.trade_id} className="cursor-pointer text-zinc-700 transition-colors duration-150 hover:bg-zinc-50"
                          onClick={() => navigate(`/research/trade/${p.trade_id}${acct !== 'setups' ? `?account=${acct}` : ''}`)}>
                          <td className="py-2 pr-3 font-sans font-medium text-zinc-800">{sym(p.symbol)}</td>
                          <td className="py-2 pr-3 font-sans"><Badge>{SIDE[p.side] ?? p.side} {num(p.leverage, 0)}x</Badge></td>
                          <td className="py-2 pr-3 text-right tabular-nums">{num(p.mark)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{num(p.avg_entry)}</td>
                          <td className={`py-2 pr-3 text-right font-medium tabular-nums ${(p.upnl ?? 0) > 0 ? 'text-verdict-hit' : (p.upnl ?? 0) < 0 ? 'text-verdict-miss' : ''}`}>{signedUsd(p.upnl)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{num(p.sl_price)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{tp ? num(tp) : '—'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{num(p.liquidation_price)}</td>
                          <td className="py-2 text-right tabular-nums text-zinc-500">{dur(p.holding_s)}</td>
                          {isManual && (
                            <td className="py-2 pl-2 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  run('平仓中…', async () => {
                                    const r = await manualClose(p.trade_id, '实盘已平，手动同步')
                                    return r.ok ? `#${p.trade_id} 已平仓` : `失败：${r.error ?? '未知'}`
                                  })
                                }}
                                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 font-sans text-2xs font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 active:translate-y-px">
                                平仓
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </QueryGate>
        </Panel>

        <Panel className="lg:col-span-2" title="权益曲线（已实现，按平仓顺序）">
          {equityPts.length < 2 ? (
            <EmptyState title="还没有已平仓交易" hint="平仓后按顺序累计出权益曲线" />
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityPts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={CHART.grid.stroke} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
                    tickFormatter={(t) => when(new Date(t).toISOString())}
                    tick={CHART.axisTick} tickLine={false} axisLine={CHART.axisLine} minTickGap={56} />
                  <YAxis width={52} domain={['auto', 'auto']} tick={CHART.axisTick}
                    tickFormatter={(v) => fmtNum(v)} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={CHART.tooltip}
                    labelFormatter={(t) => when(new Date(t as number).toISOString())}
                    formatter={(v: number) => [usd(v), '权益']} />
                  <ReferenceLine y={s.initial_balance} stroke="#d4d4d8" strokeDasharray="4 4" />
                  <Line type="stepAfter" dataKey="eq" stroke={CHART.seriesMain} strokeWidth={1.4}
                    dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ⑤ 交易记录 */}
      <div className="mt-4">
        <Panel title={`交易记录 · ${(trades.data ?? []).length}`}>
          <QueryGate q={trades} skeletonHeight={180}>
            {(ts) => ts.length === 0 ? (
              <EmptyState title="还没有交易" hint={isManual ? '上方表单录入实盘交易' : 'setup 触发并确认后出现'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-zinc-400">
                      {[
                        { h: '#' }, { h: '标的' }, { h: '方向' }, { h: '策略' }, { h: '状态' }, { h: '开仓' },
                        { h: '时长', right: true }, { h: '盈亏', right: true }, { h: '实际R', right: true },
                        { h: '结果' }, { h: '判定' },
                      ].map((c) => (
                        <th key={c.h} className={`py-1.5 pr-3 font-medium ${c.right ? 'text-right' : ''}`}>{c.h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {ts.map((t: any) => (
                      <tr key={t.id}
                        onClick={() => navigate(`/research/trade/${t.id}${acct !== 'setups' ? `?account=${acct}` : ''}`)}
                        className="cursor-pointer text-zinc-700 transition-colors duration-150 hover:bg-zinc-50">
                        <td className="py-2 pr-3 font-mono text-xs text-zinc-400">{t.id}</td>
                        <td className="py-2 pr-3 font-medium text-zinc-800">{sym(t.symbol)}</td>
                        <td className="py-2 pr-3"><Badge>{SIDE[t.side] ?? t.side} {num(t.leverage, 0)}x</Badge></td>
                        <td className="py-2 pr-3 text-zinc-500">
                          {t.setup_key
                            ? <span className="font-mono text-xs text-zinc-600">{t.setup_key}</span>
                            : (STRATEGY[t.strategy_type] ?? t.strategy_type ?? '—')}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={t.status === 'open' ? 'font-medium text-zinc-800' : 'text-zinc-400'}>{STATUS[t.status] ?? t.status}</span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{when(t.opened_at)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs text-zinc-500">{dur(t.holding_s)}</td>
                        <td className={`py-2 pr-3 text-right font-mono tabular-nums ${
                          t.pnl_abs == null ? 'text-zinc-400' : t.pnl_abs > 0 ? 'text-verdict-hit' : t.pnl_abs < 0 ? 'text-verdict-miss' : ''}`}>
                          {t.pnl_abs == null ? '—' : signedUsd(t.pnl_abs)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">{t.realized_r == null ? '—' : rr(t.realized_r)}</td>
                        <td className="py-2 pr-3">
                          {t.outcome ? (
                            <Badge tone={t.outcome === 'win' ? 'hit' : t.outcome === 'loss' ? 'miss' : 'neutral'}>{OUTCOME[t.outcome] ?? t.outcome}</Badge>
                          ) : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="py-2 pr-3">
                          {t.skill_vs_luck ? (
                            <Badge tone={t.skill_vs_luck.startsWith('right') ? 'hit' : 'miss'}>{SKILL_LUCK_SHORT[t.skill_vs_luck] ?? t.skill_vs_luck}</Badge>
                          ) : <span className="text-zinc-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryGate>
        </Panel>
      </div>

      {/* ⑥ 不交易也是要评测的判断（setup 账户无酌情拒绝） */}
      {!isSetups && (
        <div className="mt-4">
          <Panel title={`不交易记录 · ${(declines.data ?? []).length}`}>
            <QueryGate q={declines} skeletonHeight={80}>
              {(ds) => ds.length === 0 ? (
                <EmptyState title="暂无" hint="Claude 评估后选择不交易时记录在这里" />
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {ds.map((d: any) => (
                    <li key={d.id} className="py-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-zinc-800">{sym(d.symbol)}</span>
                        <span className="font-mono text-2xs text-zinc-400">{when(d.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-zinc-600">{d.reason}</p>
                      {d.watch_for && <p className="mt-0.5 text-xs text-zinc-400">再看条件：{d.watch_for}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </QueryGate>
          </Panel>
        </div>
      )}

      {/* ⑦ 已关闭实验的对照操作（降级折叠，UX Audit S3 执行） */}
      {managed && (
        <details className="mt-8 border-t border-zinc-100 pt-4">
          <summary className="cursor-pointer list-none text-xs text-zinc-400 transition-colors hover:text-zinc-600">
            对照实验操作 ›（酌情模式已于 2026-07 正式关闭，此处仅作对照复现）
          </summary>
          <DiscretionaryOps acct={acct} symbols={symbols.data ?? []} busy={busy}
            forceOn={s.force_trade ?? false} run={run} />
        </details>
      )}
    </PageShell>
  )
}

// 酌情实验的操作组：评估/扫描/强制/推进。不再占页头 C 位。
function DiscretionaryOps({ acct, symbols, busy, forceOn, run }: {
  acct: string
  symbols: string[]
  busy: boolean
  forceOn: boolean
  run: (label: string, fn: () => Promise<string>) => Promise<void>
}) {
  const [symbol, setSymbol] = useState('BTC/USDT')
  const btn = 'rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 active:translate-y-px disabled:opacity-40'
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Select value={symbol} onChange={setSymbol} className="w-36"
        options={(symbols.length ? symbols : ['BTC/USDT']).map((x) => ({ value: x, label: x.replace(':USDT', '') }))} />
      <button disabled={busy} className={btn}
        onClick={() => run('Claude 正在分析并决策，可能需要 1~2 分钟…', async () => {
          const r = await openTrade(symbol.trim(), acct)
          if (r.kind === 'decline') return `Claude 选择不交易：${r.reason}`
          if (r.kind === 'rejected') return `引擎拒绝（${r.by ?? '约束'}）：${r.reason}`
          if (r.rejected) return `计划未通过校验：${(r.issues || []).join('；')}`
          return `已开仓 #${r.trade_id}（盈亏比 ${num(r.rr)}）`
        })}>
        让 Claude 评估
      </button>
      <button disabled={busy} className={btn} title="Claude 在全标的里自主扫描机会"
        onClick={() => run('Claude 正在扫描全标的找机会，可能需要几分钟…', async () => {
          const r = await scanTrading(acct)
          if (r.note) return `未开新仓：${r.note}`
          const opened = (r.opened || []).filter((o: any) => o.trade_id)
          return `扫描 ${r.scanned} 个标的，候选 ${(r.candidates || []).length}，开仓 ${opened.length}${r.market_note ? `；${r.market_note}` : ''}`
        })}>
        自主扫描
      </button>
      <button disabled={busy} className={btn} title="开启后 Claude 进场不允许「不交易」"
        onClick={() => run(forceOn ? '关闭强制…' : '开启强制…', async () => {
          await setForceTrade(!forceOn, acct)
          return !forceOn ? '强制交易已开启：Claude 不能选择不交易' : '强制交易已关闭'
        })}>
        强制交易：{forceOn ? '开' : '关'}
      </button>
      <button disabled={busy} className={btn} title="手动推进一拍（撮合/盯市/管理）——引擎调试用"
        onClick={() => run('推进中…', async () => {
          const r = await tickTrading(acct)
          return `推进完成：成交/止盈止损 ${(r.actions || []).length} 项，管理 ${(r.managed || []).length}，复盘 ${(r.reviewed || []).length}`
        })}>
        推进一拍
      </button>
    </div>
  )
}
