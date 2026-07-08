import { useCallback, useEffect, useState } from 'react'
import { Funnel, ListChecks } from '@phosphor-icons/react'
import { fetchSetups, type SetupsView } from '../../api'
import { Badge, EmptyState, Panel } from '../ui'
import {
  num, rr, sym, when,
  SETUP_STATUS, SIDE, VERDICT, VETO_CATEGORY,
} from '../trading'

// 净收益（名义本金比例）→ 百分比展示，与回测先验同单位
const netPct = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`

// Playbook 评测板：按 setup 评 edge（live vs 回测先验）+ 信号漏斗 + 否决力 + 信号流。
// 评测台重定位后的核心视图——评的是 setup 类型在 N 次里赚不赚，不是单笔判断。
export default function SetupsPanel({ account, refreshKey, onOpenTrade }: {
  account: string
  refreshKey: number
  onOpenTrade: (id: number) => void
}) {
  const [view, setView] = useState<SetupsView | null>(null)

  const load = useCallback(
    () => fetchSetups(account).then(setView).catch(() => {}),
    [account],
  )
  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load, refreshKey])

  const registry = view?.registry ?? {}
  const scorecard = view?.scorecard ?? []
  const signals = view?.signals ?? []
  const scByKey: Record<string, any> = Object.fromEntries(scorecard.map((r: any) => [r.setup_key, r]))
  // 行 = 注册表 ∪ 有数据的 key（含酌情遗留 discretionary）
  const keys = [...new Set([...Object.keys(registry), ...scorecard.map((r: any) => r.setup_key)])]

  return (
    <>
      <Panel
        title={<span className="flex items-center gap-1.5"><ListChecks size={15} weight="bold" className="text-emerald-600" />Playbook · 按 setup 评 edge</span>}
        right={<span className="text-[11px] text-zinc-400">先验来自预注册回测 · live 与先验同单位（净收益/名义本金）</span>}
      >
        {keys.length === 0 ? (
          <EmptyState title="playbook 为空" hint="在 backend playbook.py 注册 setup（走 git 审阅）" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                  <th className="py-1.5 pr-3 font-medium">Setup</th>
                  <th className="py-1.5 pr-3 font-medium">状态</th>
                  <th className="py-1.5 pr-3 text-right font-medium">先验 净收益/笔</th>
                  <th className="py-1.5 pr-3 text-right font-medium">先验 N · 命中</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Live 净收益/笔</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Live N · 胜率</th>
                  <th className="py-1.5 pr-3 text-right font-medium">期望R · vs 持有</th>
                  <th className="py-1.5 pr-3 text-right font-medium">漏斗 触发→确认</th>
                  <th className="py-1.5 text-right font-medium">否决力</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {keys.map((k) => {
                  const reg = registry[k]
                  const sc = scByKey[k] ?? {}
                  const prior = reg?.prior
                  const f = sc.signals
                  const vq = sc.veto_quality
                  return (
                    <tr key={k} className="text-zinc-700">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-zinc-800">{reg?.name ?? (k === 'discretionary' ? '酌情交易（对照）' : k)}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                          {k}{reg?.hypothesis_ref ? ` · ${reg.hypothesis_ref}` : ''}
                          {reg?.symbols ? ` · ${reg.symbols.map(sym).join('/')}` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {reg ? (
                          <Badge tone={reg.status === 'validated' ? 'accent' : 'neutral'}>
                            {SETUP_STATUS[reg.status] ?? reg.status}
                          </Badge>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600"
                        title={prior?.regime_notes}>
                        {prior ? netPct(prior.avg_net_return) : '—'}
                        {prior && <span className="text-[11px] text-zinc-400"> (CI {netPct(prior.ci_low)})</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                        {prior ? `${prior.n} · ${(prior.hit_rate * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className={`py-2 pr-3 text-right font-mono font-medium tabular-nums ${
                        sc.avg_net_return == null ? 'text-zinc-400' : sc.avg_net_return > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {netPct(sc.avg_net_return)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                        {sc.closed_trades ? `${sc.closed_trades} · ${sc.win_rate != null ? (sc.win_rate * 100).toFixed(0) + '%' : '—'}` : '0'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                        {sc.expectancy_r != null ? rr(sc.expectancy_r) : '—'}
                        {sc.avg_bh_r != null && <span className="text-[11px] text-zinc-400"> · bh {rr(sc.avg_bh_r)}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                        {f ? `${f.total} → ${f.confirmed}${f.vetoed ? ` (否${f.vetoed})` : ''}${f.skipped ? ` (满${f.skipped})` : ''}` : '—'}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-zinc-500">
                        {vq ? `${(vq.avoid_rate * 100).toFixed(0)}% (${vq.avoided_loss}/${vq.verified})` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          Claude 在此账户只做闸门：确定性规则触发 → 只判「干净实例 + 定性否决」→ 引擎按模板执行、到时平仓。
          Live 净收益与先验出现重大落差 = 不过 Phase 4 门。候选(candidate) setup 仅纸面积累对照，不代表可信 edge。
        </p>
      </Panel>

      <div className="mt-3">
        <Panel title={<span className="flex items-center gap-1.5"><Funnel size={15} weight="bold" className="text-zinc-500" />信号流 · {signals.length}</span>}>
          {signals.length === 0 ? (
            <EmptyState title="还没有触发记录" hint="探测每小时自动跑；也可手动「探测一轮」" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {signals.map((s: any) => {
                const ret = s.features?.ret_lookback
                const hypo = s.hypo_outcome
                return (
                  <li key={s.id}
                    className={`py-2.5 ${s.trade_id ? 'cursor-pointer hover:bg-zinc-50/60' : ''}`}
                    onClick={() => s.trade_id && onOpenTrade(s.trade_id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-zinc-400">{when(s.created_at)}</span>
                      <span className="text-[13px] font-medium text-zinc-800">{sym(s.symbol)}</span>
                      <Badge tone={s.side === 'long' ? 'accent' : 'neutral'}>{SIDE[s.side] ?? s.side}</Badge>
                      <span className="font-mono text-[11px] text-zinc-400">{s.setup_key}</span>
                      {ret != null && (
                        <span className="font-mono text-[11px] text-zinc-500">{netPct(ret, 1)}/回看</span>
                      )}
                      <Badge tone={s.verdict === 'confirmed' ? 'accent' : s.verdict === 'vetoed' ? 'high' : 'neutral'}>
                        {VERDICT[s.verdict] ?? s.verdict ?? '待裁'}
                      </Badge>
                      {s.veto_category && (
                        <span className="text-[11px] text-zinc-400">{VETO_CATEGORY[s.veto_category] ?? s.veto_category}</span>
                      )}
                      {s.trade_id && <span className="font-mono text-[11px] text-zinc-400">#{s.trade_id}</span>}
                      {hypo && (
                        <span className={`ml-auto font-mono text-[11px] ${hypo.avoided_loss ? 'text-emerald-600' : 'text-rose-600'}`}>
                          假想 {netPct(hypo.hypo_net_return)} · 否决{hypo.avoided_loss ? '对' : '错'}
                        </span>
                      )}
                    </div>
                    {s.reasoning && (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500" title={s.reasoning}>
                        {s.reasoning.length > 160 ? s.reasoning.slice(0, 160) + '…' : s.reasoning}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
