import { useCallback, useEffect, useState } from 'react'
import { ArrowsClockwise, Brain, Lightning, MagnifyingGlass, Prohibit, Pulse, Receipt } from '@phosphor-icons/react'
import {
  fetchDeclines,
  fetchPositions,
  fetchTradeTimeline,
  fetchTrades,
  fetchTradingAccount,
  openTrade,
  scanTrading,
  setForceTrade,
  tickTrading,
} from '../../api'
import { Badge, EmptyState, Kpi, KpiRow, Panel, PageShell } from '../ui'

const usd = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const num = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number(n).toFixed(d)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(2)}%`)
const dur = (s: number | null | undefined) => {
  if (s == null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}
const when = (ts?: string) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const SIDE = (s: string) => (s === 'long' ? '做多' : s === 'short' ? '做空' : s)
const STATUS: Record<string, string> = {
  planned: '计划', open: '持仓中', closed: '已平仓', cancelled: '已取消',
}
const SKILL_LUCK: Record<string, string> = {
  right_judgment_profit: '判断对·赚（真本事）',
  right_judgment_loss: '判断对·亏（运气差）',
  wrong_judgment_profit: '判断错·赚（运气好）',
  wrong_judgment_loss: '判断错·亏（该认的错）',
}

export default function Trading() {
  const [account, setAccount] = useState<any>(null)
  const [trades, setTrades] = useState<any[]>([])
  const [positions, setPositions] = useState<any[]>([])
  const [declines, setDeclines] = useState<any[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [timeline, setTimeline] = useState<any>(null)
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [a, t, p, d] = await Promise.all([
      fetchTradingAccount(), fetchTrades(), fetchPositions(), fetchDeclines(),
    ])
    setAccount(a)
    setTrades(t)
    setPositions(p)
    setDeclines(d)
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
    const id = setInterval(() => refresh().catch(() => {}), 15000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (selected == null) {
      setTimeline(null)
      return
    }
    fetchTradeTimeline(selected).then(setTimeline).catch(() => {})
  }, [selected, trades])

  const onOpen = async () => {
    setBusy(true)
    setMsg('Claude 正在分析并决策，可能需要 1~2 分钟…')
    try {
      const r = await openTrade(symbol.trim())
      if (r.kind === 'decline') setMsg(`Claude 选择不交易：${r.reason}`)
      else if (r.rejected) setMsg(`计划未通过校验：${(r.issues || []).join('；')}`)
      else setMsg(`已开仓 #${r.trade_id}（盈亏比 ${num(r.rr)}）`)
      await refresh()
    } catch (e: any) {
      setMsg(`失败：${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const onScan = async () => {
    setBusy(true)
    setMsg('Claude 正在扫描全标的找机会，可能需要几分钟…')
    try {
      const r = await scanTrading()
      if (r.note) setMsg(`未开新仓：${r.note}`)
      else {
        const opened = (r.opened || []).filter((o: any) => o.trade_id)
        setMsg(`扫描 ${r.scanned} 个标的，候选 ${(r.candidates || []).length}，开仓 ${opened.length}${r.market_note ? `；${r.market_note}` : ''}`)
      }
      await refresh()
    } catch (e: any) {
      setMsg(`失败：${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const onToggleForce = async () => {
    const next = !(account?.summary?.force_trade ?? false)
    try {
      await setForceTrade(next)
      setMsg(next ? '强制交易已开启：Claude 本次起不能选择不交易' : '强制交易已关闭：Claude 可自行决定不交易')
      await refresh()
    } catch (e: any) {
      setMsg(`失败：${e.message || e}`)
    }
  }

  const onTick = async () => {
    setBusy(true)
    setMsg('推进中…')
    try {
      const r = await tickTrading()
      const acts = (r.actions || []).length
      setMsg(`推进完成：成交/止盈止损 ${acts} 项，管理 ${(r.managed || []).length}，复盘 ${(r.reviewed || []).length}`)
      await refresh()
    } catch (e: any) {
      setMsg(`失败：${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const s = account?.summary ?? {}
  const sc = account?.scorecard ?? {}

  return (
    <PageShell
      title="交易评测台"
      sub="Claude 在纸面永续账户跑完整交易，评测判断力与策略质量（全自主 · 实时前向）"
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="BTC/USDT"
            className="w-28 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-zinc-400"
          />
          <button
            onClick={onOpen}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-zinc-800 active:translate-y-px disabled:opacity-40"
          >
            <Brain size={15} weight="bold" /> 让 Claude 评估
          </button>
          <button
            onClick={onScan}
            disabled={busy}
            title="Claude 在全标的里自主扫描机会(受持仓/风险上限约束)"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px disabled:opacity-40"
          >
            <MagnifyingGlass size={15} weight="bold" /> 自主扫描
          </button>
          <button
            onClick={onTick}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px disabled:opacity-40"
          >
            <ArrowsClockwise size={15} weight="bold" /> 推进一拍
          </button>
          <button
            onClick={onToggleForce}
            disabled={busy}
            title="开启后 Claude 进场决策不允许「不交易」，必须给出可执行计划"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors active:translate-y-px disabled:opacity-40 ${
              s.force_trade
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Lightning size={15} weight={s.force_trade ? 'fill' : 'bold'} />
            强制交易{s.force_trade ? '·开' : '·关'}
          </button>
        </div>
      }
    >
      {msg && (
        <div className="mb-3 rounded-xl border border-zinc-200/70 bg-white px-4 py-2.5 text-[13px] text-zinc-600">
          {msg}
        </div>
      )}

      <KpiRow>
        <Kpi label="权益" value={usd(s.equity)} />
        <Kpi label="可用现金" value={usd(s.balance)} />
        <Kpi label="占用保证金" value={usd(s.used_margin)} />
        <Kpi label="已平笔数" value={String(sc.closed_trades ?? 0)} />
        <Kpi
          label="胜率"
          value={sc.win_rate != null ? pct(sc.win_rate * 100) : '—'}
        />
        <Kpi
          label="总盈亏"
          value={usd(sc.total_pnl)}
          tone={(sc.total_pnl ?? 0) > 0 ? 'up' : (sc.total_pnl ?? 0) < 0 ? 'down' : 'neutral'}
          sub={sc.avg_r != null ? `平均 ${num(sc.avg_r)}R` : undefined}
        />
      </KpiRow>

      <div className="mt-3">
        <Panel title={<span className="flex items-center gap-1.5"><Pulse size={15} weight="bold" className="text-emerald-600" />持仓实时状态</span>}>
          {positions.length === 0 ? (
            <EmptyState icon={<Pulse size={26} weight="thin" />} title="当前无持仓" hint="开仓后这里实时显示盯市状态" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-400">
                    <th className="py-1.5 pr-3 font-medium">标的</th>
                    <th className="py-1.5 pr-3 font-medium">方向</th>
                    <th className="py-1.5 pr-3 text-right font-medium">标记价</th>
                    <th className="py-1.5 pr-3 text-right font-medium">均价</th>
                    <th className="py-1.5 pr-3 text-right font-medium">浮动盈亏</th>
                    <th className="py-1.5 pr-3 text-right font-medium">距止损</th>
                    <th className="py-1.5 pr-3 text-right font-medium">距止盈</th>
                    <th className="py-1.5 pr-3 text-right font-medium">强平价</th>
                    <th className="py-1.5 pr-3 text-right font-medium">持仓时长</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-mono">
                  {positions.map((p) => (
                    <tr key={p.trade_id} className="text-zinc-700">
                      <td className="py-2 pr-3 font-sans font-medium text-zinc-800">{p.symbol}</td>
                      <td className="py-2 pr-3 font-sans"><Badge tone={p.side === 'long' ? 'accent' : 'neutral'}>{SIDE(p.side)} {num(p.leverage, 0)}x</Badge></td>
                      <td className="py-2 pr-3 text-right">{num(p.mark, 4)}</td>
                      <td className="py-2 pr-3 text-right text-zinc-500">{num(p.avg_entry, 4)}</td>
                      <td className={`py-2 pr-3 text-right font-medium ${(p.upnl ?? 0) > 0 ? 'text-emerald-600' : (p.upnl ?? 0) < 0 ? 'text-rose-600' : ''}`}>{usd(p.upnl)}</td>
                      <td className="py-2 pr-3 text-right text-zinc-500">{num(p.dist_sl, 4)}</td>
                      <td className="py-2 pr-3 text-right text-zinc-500">{p.dist_tp == null ? '—' : num(p.dist_tp, 4)}</td>
                      <td className="py-2 pr-3 text-right text-rose-500/80">{num(p.liquidation_price, 4)}</td>
                      <td className="py-2 pr-3 text-right text-zinc-500">{dur(p.holding_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* 左：交易列表 + 不交易记录 */}
        <div className="flex flex-col gap-3 lg:col-span-2">
          <Panel title="交易">
            {trades.length === 0 ? (
              <EmptyState icon={<Receipt size={26} weight="thin" />} title="还没有交易" hint="输入标的，让 Claude 评估并开仓" />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {trades.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelected(t.id)}
                      className={`flex w-full items-center justify-between gap-2 py-2.5 text-left transition-colors ${
                        selected === t.id ? 'bg-zinc-50' : 'hover:bg-zinc-50/70'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-zinc-400">#{t.id}</span>
                        <span className="text-sm font-medium text-zinc-800">{t.symbol}</span>
                        <Badge tone={t.side === 'long' ? 'accent' : 'neutral'}>{SIDE(t.side)}</Badge>
                      </div>
                      <span className="text-xs text-zinc-400">{STATUS[t.status] ?? t.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="不交易记录（也是被评测的判断）">
            {declines.length === 0 ? (
              <EmptyState icon={<Prohibit size={24} weight="thin" />} title="暂无" />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {declines.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-700">{d.symbol}</span>
                      <span className="font-mono text-[11px] text-zinc-400">{when(d.created_at)}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-zinc-600">{d.reason}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* 右：单笔时间线详情 */}
        <div className="lg:col-span-3">
          {timeline ? <TradeDetail tl={timeline} /> : (
            <Panel title="详情">
              <EmptyState title="选择一笔交易查看完整时间线" hint="决策依据 · 计划 · 持仓 · 调整 · 结果 · 复盘" />
            </Panel>
          )}
        </div>
      </div>
    </PageShell>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  const c = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-zinc-800'
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12px] text-zinc-400">{k}</span>
      <span className={`font-mono text-[13px] tabular-nums ${c}`}>{v}</span>
    </div>
  )
}

function TradeDetail({ tl }: { tl: any }) {
  const t = tl.trade
  const plans = tl.plans ?? []
  const active = plans[plans.length - 1]?.plan
  const v1 = plans[0]?.plan
  const computed = v1?.computed ?? {}
  const result = tl.result
  const review = tl.review?.review
  const events = tl.events ?? []
  const orders = tl.orders ?? []

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={`#${t.id} ${t.symbol}`}
        right={<Badge tone={t.side === 'long' ? 'accent' : 'neutral'}>{SIDE(t.side)} · {STATUS[t.status] ?? t.status}</Badge>}
      >
        {v1 && (
          <>
            <div className="text-[13px] leading-relaxed text-zinc-700">{v1.thesis}</div>
            <div className="mt-2 grid grid-cols-2 gap-x-6">
              <Row k="策略" v={v1.strategy_type} />
              <Row k="市场环境" v={v1.regime} />
              <Row k="进场" v={`${v1.entry_type} @ ${num(v1.entry_price)}`} />
              <Row k="止损" v={num(v1.sl_price)} />
              <Row k="盈亏比(计划)" v={num(computed.rr)} />
              <Row k="风险%" v={num(v1.risk_pct)} />
              <Row k="数量" v={num(computed.qty, 4)} />
              <Row k="杠杆" v={`${num(t.leverage)}x`} />
              <Row k="强平价" v={num(computed.liquidation_price)} />
              <Row k="止盈" v={(v1.tp_targets || []).map((x: any) => `${num(x.price)}(${x.reduce_pct}%)`).join(' · ')} />
            </div>
            <div className="mt-2 text-[12px] text-zinc-500">
              <span className="text-zinc-400">多周期：</span>
              {v1.mtf?.aligned ? '三周期共振' : '周期未共振'} · {v1.mtf?.higher_tf}
            </div>
          </>
        )}
      </Panel>

      {result && (
        <Panel title="结果（引擎客观核算）">
          <div className="grid grid-cols-2 gap-x-6">
            <Row k="盈亏" v={usd(result.pnl_abs)} tone={result.pnl_abs > 0 ? 'up' : result.pnl_abs < 0 ? 'down' : undefined} />
            <Row k="盈亏%(对保证金)" v={pct(result.pnl_pct)} tone={result.pnl_abs > 0 ? 'up' : 'down'} />
            <Row k="实际R" v={num(result.realized_r)} />
            <Row k="计划R" v={num(result.planned_r)} />
            <Row k="出场原因" v={result.exit_reason} />
            <Row k="结果" v={result.outcome} tone={result.outcome === 'win' ? 'up' : result.outcome === 'loss' ? 'down' : undefined} />
            <Row k="持仓(分钟)" v={num((result.holding_s ?? 0) / 60, 1)} />
            <Row k="手续费" v={usd(result.fees)} />
          </div>
        </Panel>
      )}

      {review && (
        <Panel title="复盘（Claude）">
          <Row k="技能/运气" v={SKILL_LUCK[review.skill_vs_luck] ?? review.skill_vs_luck} />
          <div className="mt-1 space-y-1.5 text-[13px] text-zinc-600">
            <p><span className="text-zinc-400">纪律：</span>{review.plan_adherence}</p>
            {(review.discipline_violations || []).length > 0 && (
              <p className="text-rose-600">违规：{review.discipline_violations.join('；')}</p>
            )}
            <p><span className="text-zinc-400">进场：</span>{review.entry_timing}</p>
            <p><span className="text-zinc-400">出场：</span>{review.exit_timing}</p>
            <p><span className="text-zinc-400">改进：</span>{review.lessons}</p>
          </div>
        </Panel>
      )}

      {plans.length > 1 && (
        <Panel title="计划调整历史">
          <ul className="space-y-2">
            {plans.slice(1).map((p: any) => (
              <li key={p.version} className="text-[13px]">
                <span className="font-mono text-xs text-zinc-400">v{p.version}</span>{' '}
                <span className="text-zinc-700">{p.plan?.adjustment?.action}</span>{' '}
                <span className="text-zinc-500">{p.plan?.adjustment?.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="事件时间线">
        {events.length === 0 ? (
          <EmptyState title="暂无" />
        ) : (
          <ul className="space-y-1.5">
            {events.map((e: any, i: number) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className="font-mono text-zinc-400">{when(e.ts)}</span>
                <span className="text-zinc-700">{e.kind}</span>
                <span className="text-zinc-400">{e.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {orders.length > 0 && (
        <Panel title="成交记录">
          <ul className="divide-y divide-zinc-100">
            {orders.map((o: any) => (
              <li key={o.id} className="flex items-center justify-between py-1.5 text-[12px]">
                <span className="text-zinc-600">{o.kind}</span>
                <span className="font-mono tabular-nums text-zinc-700">
                  {num(o.qty, 4)} @ {num(o.price)} · {o.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
