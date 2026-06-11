import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowsClockwise, Brain, CaretRight, Lightning, MagnifyingGlass, Prohibit, Pulse, Receipt,
} from '@phosphor-icons/react'
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  fetchDeclines, fetchPositions, fetchTrades, fetchTradingAccount, fetchTradingAccounts,
  fetchTradingSymbols, openTrade, scanTrading, setForceTrade, tickTrading,
  type TradingAccount,
} from '../../api'
import { Badge, EmptyState, Kpi, KpiRow, PageShell, Panel, SegTabs, Select } from '../ui'
import { fmtNum } from '../format'
import {
  dur, num, pct, rr, sym, signedUsd, usd, when,
  OUTCOME, SIDE, SKILL_LUCK_SHORT, STATUS, STRATEGY,
} from '../trading'
import TradeDetail from './TradeDetail'

const ACCT_LABEL: Record<string, string> = { main: 'A · 自然', forced: 'B · 强制', main_shadow: '影子 · 不管理' }

export default function Trading() {
  const [account, setAccount] = useState<any>(null)
  const [trades, setTrades] = useState<any[]>([])
  const [positions, setPositions] = useState<any[]>([])
  const [declines, setDeclines] = useState<any[]>([])
  const [symbols, setSymbols] = useState<string[]>(['BTC/USDT'])
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // 交易详情是独立页面：选中即整页切换，返回回到总览
  const [tradeId, setTradeId] = useState<number | null>(null)
  // 多账户对照：A 自然 / B 强制 / 影子
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [acct, setAcct] = useState('main')
  const managed = accounts.find((a) => a.name === acct)?.managed ?? true

  const refresh = useCallback(async () => {
    const [a, t, p, d] = await Promise.all([
      fetchTradingAccount(acct), fetchTrades(acct), fetchPositions(acct), fetchDeclines(acct),
    ])
    setAccount(a); setTrades(t); setPositions(p); setDeclines(d)
  }, [acct])

  // 账户列表只用于切换标签（基本不变），拉一次即可——它会对所有账户重算权益/计分卡，别每 15s 拉
  useEffect(() => {
    fetchTradingAccounts().then((accs) => accs.length && setAccounts(accs)).catch(() => {})
    fetchTradingSymbols().then((s) => s.length && setSymbols(s)).catch(() => {})
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
    const id = setInterval(() => refresh().catch(() => {}), 15000)
    return () => clearInterval(id)
  }, [refresh])

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true); setMsg(label)
    try { setMsg(await fn()); await refresh() }
    catch (e: any) { setMsg(`失败：${e.message || e}`) }
    finally { setBusy(false) }
  }

  const onOpen = () => run('Claude 正在分析并决策，可能需要 1~2 分钟…', async () => {
    const r = await openTrade(symbol.trim(), acct)
    if (r.kind === 'decline') return `Claude 选择不交易：${r.reason}`
    if (r.kind === 'rejected') return `引擎拒绝（${r.by ?? '约束'}）：${r.reason}`
    if (r.rejected) return `计划未通过校验：${(r.issues || []).join('；')}`
    return `已开仓 #${r.trade_id}（盈亏比 ${num(r.rr)}）`
  })
  const onScan = () => run('Claude 正在扫描全标的找机会，可能需要几分钟…', async () => {
    const r = await scanTrading(acct)
    if (r.note) return `未开新仓：${r.note}`
    const opened = (r.opened || []).filter((o: any) => o.trade_id)
    return `扫描 ${r.scanned} 个标的，候选 ${(r.candidates || []).length}，开仓 ${opened.length}${r.market_note ? `；${r.market_note}` : ''}`
  })
  const onTick = () => run('推进中…', async () => {
    const r = await tickTrading(acct)
    return `推进完成：成交/止盈止损 ${(r.actions || []).length} 项，管理 ${(r.managed || []).length}，复盘 ${(r.reviewed || []).length}`
  })
  const onToggleForce = async () => {
    const next = !(account?.summary?.force_trade ?? false)
    try { await setForceTrade(next, acct); setMsg(next ? '强制交易已开启：Claude 不能选择不交易' : '强制交易已关闭'); await refresh() }
    catch (e: any) { setMsg(`失败：${e.message || e}`) }
  }

  const s = account?.summary ?? {}
  const sc = account?.scorecard ?? {}

  // 权益曲线：按平仓顺序累计已实现盈亏（评测的主曲线）
  const equityPts = useMemo(() => {
    const init = s.initial_balance
    if (init == null) return []
    const closed = trades
      .filter((t) => t.status === 'closed' && t.pnl_abs != null && t.closed_at)
      .sort((a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime())
    if (closed.length === 0) return []
    let eq = init
    const start = trades.reduce(
      (m, t) => Math.min(m, new Date(t.created_at ?? t.closed_at).getTime()),
      new Date(closed[0].closed_at).getTime(),
    )
    return [
      { t: start, eq: init },
      ...closed.map((t) => ({ t: new Date(t.closed_at).getTime(), eq: (eq += t.pnl_abs) })),
    ]
  }, [trades, s.initial_balance])

  if (tradeId != null) {
    return <TradeDetail id={tradeId} onBack={() => setTradeId(null)} />
  }

  return (
    <PageShell
      title="交易评测"
      sub="Claude 在纸面永续账户全自主交易 · 实时前向 · 评测判断力与策略质量"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <SegTabs size="sm" value={acct} onChange={(v) => { setAcct(v); setTradeId(null) }}
              options={accounts.map((a) => ({ value: a.name, label: ACCT_LABEL[a.name] ?? a.name }))} />
          )}
          {managed ? (
            <>
              <Select value={symbol} onChange={setSymbol} className="w-36"
                options={symbols.map((x) => ({ value: x, label: x.replace(':USDT', '') }))} />
              <button onClick={onOpen} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-zinc-800 active:translate-y-px disabled:opacity-40">
                <Brain size={15} weight="bold" /> 让 Claude 评估
              </button>
              <button onClick={onScan} disabled={busy} title="Claude 在全标的里自主扫描机会"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px disabled:opacity-40">
                <MagnifyingGlass size={15} weight="bold" /> 自主扫描
              </button>
              <button onClick={onToggleForce} disabled={busy} title="开启后 Claude 进场不允许「不交易」"
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors active:translate-y-px disabled:opacity-40 ${
                  s.force_trade ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'}`}>
                <Lightning size={15} weight={s.force_trade ? 'fill' : 'bold'} /> 强制{s.force_trade ? '·开' : '·关'}
              </button>
              <button onClick={onTick} disabled={busy} title="手动推进一拍（撮合/盯市/管理）"
                className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-100 active:translate-y-px disabled:opacity-40">
                <ArrowsClockwise size={15} weight="bold" />
              </button>
            </>
          ) : (
            <span className="text-[12px] text-zinc-400">影子账户：机械镜像 {accounts.find((a) => a.name === acct)?.mirror_of ?? 'main'} 的进场，不接受手动操作</span>
          )}
        </div>
      }
    >
      {msg && (
        <div className="mb-3 rounded-xl border border-zinc-200/70 bg-white px-4 py-2.5 text-[13px] text-zinc-600">{msg}</div>
      )}

      {/* 账户 + 计分卡 */}
      <KpiRow cols={8}>
        <Kpi label="权益" value={usd(s.equity)} sub={s.initial_balance != null ? `初始 ${usd(s.initial_balance)}` : undefined} />
        <Kpi label="可用现金" value={usd(s.balance)} />
        <Kpi label="占用保证金" value={usd(s.used_margin)} />
        <Kpi label="持仓 / 已平" value={`${positions.length} / ${sc.closed_trades ?? 0}`} />
        <Kpi label="胜率" value={sc.win_rate != null ? pct(sc.win_rate * 100) : '—'} />
        <Kpi label="总盈亏" value={signedUsd(sc.total_pnl)}
          tone={(sc.total_pnl ?? 0) > 0 ? 'up' : (sc.total_pnl ?? 0) < 0 ? 'down' : 'neutral'}
          sub={sc.avg_r != null ? `平均 ${rr(sc.avg_r)}` : undefined} />
        <Kpi label="期望" value={sc.expectancy_r != null ? rr(sc.expectancy_r) : '—'}
          tone={(sc.expectancy_r ?? 0) > 0 ? 'up' : (sc.expectancy_r ?? 0) < 0 ? 'down' : 'neutral'} />
        <Kpi label="盈利因子" value={num(sc.profit_factor)}
          sub={sc.max_drawdown != null ? `最大回撤 ${usd(sc.max_drawdown)}` : undefined} />
      </KpiRow>
      {/* 评测 v2：出场效率 + 管理层相对"不管理"的贡献 + 置信度校准 + 拒绝力 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-[11px] text-zinc-400">
        <span>模式 <b className="font-mono text-zinc-600">{s.margin_mode === 'cross' ? '全仓' : '逐仓'}</b></span>
        {sc.avg_exit_efficiency != null && (
          <span>出场效率 <b className="font-mono text-zinc-600">{(sc.avg_exit_efficiency * 100).toFixed(0)}%</b>
            <span className="text-zinc-300"> (吃到多少有利波动)</span></span>
        )}
        {sc.total_mgmt_contribution_r != null && (
          <span>管理贡献 <b className={`font-mono ${sc.total_mgmt_contribution_r > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {rr(sc.total_mgmt_contribution_r)}</b>
            <span className="text-zinc-300"> (vs 不管理)</span></span>
        )}
        {sc.decline_accuracy && (
          <span>拒绝力 <b className="font-mono text-zinc-600">{(sc.decline_accuracy.accuracy * 100).toFixed(0)}%</b>
            <span className="text-zinc-300"> ({sc.decline_accuracy.correct}/{sc.decline_accuracy.verified})</span></span>
        )}
        <span className="text-zinc-300">约束：≤3 持仓 · 同向 ≤2 · 总在险 ≤5% · 强制 {s.force_trade ? '开' : '关'}</span>
      </div>
      {(sc.calibration?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-400">
          <span className="text-zinc-500">置信度校准</span>
          {sc.calibration.map((c: any) => (
            <span key={c.bucket} className="font-mono">
              {c.bucket}:<b className="text-zinc-600">{(c.win_rate * 100).toFixed(0)}%</b>
              <span className="text-zinc-300">/{c.n}</span>
            </span>
          ))}
        </div>
      )}

      {/* 持仓 + 权益曲线 */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3"
          title={<span className="flex items-center gap-1.5"><Pulse size={15} weight="bold" className="text-emerald-600" />持仓实时状态</span>}>
          {positions.length === 0 ? (
            <EmptyState icon={<Pulse size={26} weight="thin" />} title="当前无持仓" hint="评估或自主扫描后这里实时盯市" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    {['标的', '方向', '标记价', '均价', '浮动盈亏', '止损', '止盈', '距强平', '时长'].map((h, i) => (
                      <th key={h} className={`py-1.5 pr-3 font-medium ${i >= 2 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-mono">
                  {positions.map((p) => {
                    const tp = (p.tp_targets || [])[0]?.price
                    return (
                      <tr key={p.trade_id} className="cursor-pointer text-zinc-700 hover:bg-zinc-50/60"
                        onClick={() => setTradeId(p.trade_id)}>
                        <td className="py-2 pr-3 font-sans font-medium text-zinc-800">{sym(p.symbol)}</td>
                        <td className="py-2 pr-3 font-sans"><Badge tone={p.side === 'long' ? 'accent' : 'neutral'}>{SIDE[p.side] ?? p.side} {num(p.leverage, 0)}x</Badge></td>
                        <td className="py-2 pr-3 text-right tabular-nums">{num(p.mark)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{num(p.avg_entry)}</td>
                        <td className={`py-2 pr-3 text-right font-medium tabular-nums ${(p.upnl ?? 0) > 0 ? 'text-emerald-600' : (p.upnl ?? 0) < 0 ? 'text-rose-600' : ''}`}>{signedUsd(p.upnl)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{num(p.sl_price)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{tp ? num(tp) : '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-rose-500/80">{num(p.liquidation_price)}</td>
                        <td className="py-2 text-right tabular-nums text-zinc-500">{dur(p.holding_s)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="lg:col-span-2" title="权益曲线（已实现，按平仓顺序）">
          {equityPts.length < 2 ? (
            <EmptyState title="还没有已平仓交易" hint="平仓后按顺序累计出权益曲线" />
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityPts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
                    tickFormatter={(t) => when(new Date(t).toISOString())}
                    tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false}
                    axisLine={{ stroke: '#e4e4e7' }} minTickGap={56} />
                  <YAxis width={52} domain={['auto', 'auto']}
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'Geist Mono' }}
                    tickFormatter={(v) => fmtNum(v)} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, fontFamily: 'Geist Mono' }}
                    labelFormatter={(t) => when(new Date(t as number).toISOString())}
                    formatter={(v: number) => [usd(v), '权益']} />
                  <ReferenceLine y={s.initial_balance} stroke="#d4d4d8" strokeDasharray="4 4" />
                  <Area type="stepAfter" dataKey="eq" stroke="#10b981" strokeWidth={1.5} fill="url(#eq)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* 交易记录：行点击进入独立详情页 */}
      <div className="mt-3">
        <Panel title={`交易记录 · ${trades.length}`}>
          {trades.length === 0 ? (
            <EmptyState icon={<Receipt size={26} weight="thin" />} title="还没有交易" hint="选标的让 Claude 评估，或自主扫描" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th className="py-1.5 pr-3 font-medium">#</th>
                    <th className="py-1.5 pr-3 font-medium">标的</th>
                    <th className="py-1.5 pr-3 font-medium">方向</th>
                    <th className="py-1.5 pr-3 font-medium">策略</th>
                    <th className="py-1.5 pr-3 font-medium">状态</th>
                    <th className="py-1.5 pr-3 font-medium">开仓</th>
                    <th className="py-1.5 pr-3 text-right font-medium">时长</th>
                    <th className="py-1.5 pr-3 text-right font-medium">盈亏</th>
                    <th className="py-1.5 pr-3 text-right font-medium">实际R</th>
                    <th className="py-1.5 pr-3 font-medium">结果</th>
                    <th className="py-1.5 pr-3 font-medium">判定</th>
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {trades.map((t) => (
                    <tr key={t.id} onClick={() => setTradeId(t.id)}
                      className="group cursor-pointer text-zinc-700 transition-colors hover:bg-zinc-50/70">
                      <td className="py-2 pr-3 font-mono text-xs text-zinc-400">{t.id}</td>
                      <td className="py-2 pr-3 font-medium text-zinc-800">{sym(t.symbol)}</td>
                      <td className="py-2 pr-3"><Badge tone={t.side === 'long' ? 'accent' : 'neutral'}>{SIDE[t.side] ?? t.side} {num(t.leverage, 0)}x</Badge></td>
                      <td className="py-2 pr-3 text-zinc-500">{STRATEGY[t.strategy_type] ?? t.strategy_type ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <span className={t.status === 'open' ? 'font-medium text-emerald-600' : 'text-zinc-400'}>{STATUS[t.status] ?? t.status}</span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{when(t.opened_at)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs text-zinc-500">{dur(t.holding_s)}</td>
                      <td className={`py-2 pr-3 text-right font-mono tabular-nums ${
                        t.pnl_abs == null ? 'text-zinc-400' : t.pnl_abs > 0 ? 'text-emerald-600' : t.pnl_abs < 0 ? 'text-rose-600' : ''}`}>
                        {t.pnl_abs == null ? '—' : signedUsd(t.pnl_abs)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">{t.realized_r == null ? '—' : rr(t.realized_r)}</td>
                      <td className="py-2 pr-3">
                        {t.outcome ? (
                          <Badge tone={t.outcome === 'win' ? 'accent' : t.outcome === 'loss' ? 'high' : 'neutral'}>{OUTCOME[t.outcome] ?? t.outcome}</Badge>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {t.skill_vs_luck ? (
                          <Badge tone={t.skill_vs_luck.startsWith('right') ? 'accent' : 'high'}>{SKILL_LUCK_SHORT[t.skill_vs_luck] ?? t.skill_vs_luck}</Badge>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        <CaretRight size={13} className="inline text-zinc-300 transition-colors group-hover:text-zinc-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* 不交易也是要评测的判断 */}
      <div className="mt-3">
        <Panel title={`不交易记录 · ${declines.length}`}>
          {declines.length === 0 ? (
            <EmptyState icon={<Prohibit size={24} weight="thin" />} title="暂无" hint="Claude 评估后选择不交易时记录在这里" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {declines.map((d) => (
                <li key={d.id} className="py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-zinc-800">{sym(d.symbol)}</span>
                    <span className="font-mono text-[11px] text-zinc-400">{when(d.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600">{d.reason}</p>
                  {d.watch_for && <p className="mt-0.5 text-[12px] text-zinc-400">再看条件：{d.watch_for}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  )
}
