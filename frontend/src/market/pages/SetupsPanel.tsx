import { fetchSetups } from '../../api'
import { useQuery } from '../../lib/useQuery'
import { Badge, EmptyState, Panel, QueryGate } from '../ui'
import { num, rr, sym, when, SETUP_STATUS, SIDE, VERDICT, VETO_CATEGORY } from '../trading'

// 净收益（名义本金比例）→ 百分比展示，与回测先验同单位
const netPct = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`

// Playbook 评测板（研究空间头版）：按 setup 评 edge（live vs 回测先验）+ 信号漏斗 + 否决力。
// 评的是 setup 类型在 N 次里赚不赚，不是单笔判断。
export default function SetupsPanel({ account, refreshKey, onOpenTrade, manual = false, onDetect, busy = false }: {
  account: string
  refreshKey: number
  onOpenTrade: (id: number) => void
  manual?: boolean // 实盘镜像账户：同一张表评用户自己的 setup 标签（无 playbook 先验列）
  onDetect?: () => void // setups 账户：手动跑一轮探测（随信号流面板存放）
  busy?: boolean
}) {
  const view = useQuery(() => fetchSetups(account), [account, refreshKey], { pollMs: 30000 })

  return (
    <QueryGate q={view} skeletonHeight={160}>
      {(v) => {
        const registry = v.registry ?? {}
        const scorecard = v.scorecard ?? []
        const signals = v.signals ?? []
        const scByKey: Record<string, any> = Object.fromEntries(scorecard.map((r: any) => [r.setup_key, r]))
        // 行 = 注册表 ∪ 有数据的 key；manual 模式只看本账户的实绩键
        const keys = manual
          ? scorecard.map((r: any) => r.setup_key)
          : [...new Set([...Object.keys(registry), ...scorecard.map((r: any) => r.setup_key)])]
        return (
          <>
            <Panel
              title={manual ? '你的 setup · 按类型评 edge' : 'Playbook · 按 setup 评 edge'}
              right={<span className="text-2xs text-zinc-400">{manual ? '同一套机械评你的酌情交易：N 次里赚不赚，不是单笔对错' : '先验来自预注册回测 · live 与先验同单位（净收益/名义本金）'}</span>}
            >
              {keys.length === 0 ? (
                manual
                  ? <EmptyState title="还没有录入的交易" hint="上方表单录入实盘交易，按 setup 标签聚合出这张表" />
                  : <EmptyState title="playbook 为空" hint="在 backend playbook.py 注册 setup（走 git 审阅）" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-2xs uppercase tracking-wide text-zinc-400">
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
                      {keys.map((k: string) => {
                        const reg = registry[k]
                        const sc = scByKey[k] ?? {}
                        const prior = reg?.prior
                        const f = sc.signals
                        const vq = sc.veto_quality
                        return (
                          <tr key={k} className="text-zinc-700">
                            <td className="py-2 pr-3">
                              <div className="font-medium text-zinc-800">{reg?.name ?? (k === 'discretionary' ? '酌情交易（对照）' : k)}</div>
                              <div className="mt-0.5 font-mono text-2xs text-zinc-400">
                                {k}{reg?.hypothesis_ref ? ` · ${reg.hypothesis_ref}` : ''}
                                {reg?.symbols ? ` · ${reg.symbols.map(sym).join('/')}` : ''}
                              </div>
                            </td>
                            <td className="py-2 pr-3">
                              {reg ? (
                                <Badge tone={reg.status === 'validated' ? 'hit' : 'neutral'}>
                                  {SETUP_STATUS[reg.status] ?? reg.status}
                                </Badge>
                              ) : <span className="text-zinc-300">—</span>}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600" title={prior?.regime_notes}>
                              {prior ? netPct(prior.avg_net_return) : '—'}
                              {prior && <span className="text-2xs text-zinc-400"> (CI {netPct(prior.ci_low)})</span>}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                              {prior ? `${prior.n} · ${(prior.hit_rate * 100).toFixed(0)}%` : '—'}
                            </td>
                            <td className={`py-2 pr-3 text-right font-mono font-medium tabular-nums ${
                              sc.avg_net_return == null ? 'text-zinc-400' : sc.avg_net_return > 0 ? 'text-verdict-hit' : 'text-verdict-miss'}`}>
                              {netPct(sc.avg_net_return)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                              {sc.closed_trades ? `${sc.closed_trades} · ${sc.win_rate != null ? (sc.win_rate * 100).toFixed(0) + '%' : '—'}` : '0'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">
                              {sc.expectancy_r != null ? rr(sc.expectancy_r) : '—'}
                              {sc.avg_bh_r != null && <span className="text-2xs text-zinc-400"> · bh {rr(sc.avg_bh_r)}</span>}
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
              <p className="mt-2 text-2xs leading-relaxed text-zinc-400">
                {manual
                  ? 'N 小时结论别当真——每类 setup 攒到 ≥30 笔再看期望；avg_bh_r 是"同窗口买入持有"的配对基准，跑不赢它=择时没加值。'
                  : 'Claude 在此账户只做闸门：确定性规则触发 → 只判「干净实例 + 定性否决」→ 引擎按模板执行、到时平仓。Live 净收益与先验出现重大落差 = 不过 Phase 4 门。候选(candidate) setup 仅纸面积累对照，不代表可信 edge。'}
              </p>
            </Panel>

            {!manual && (
              <div className="mt-3">
                <Panel title={`信号流 · ${signals.length}`}
                  right={onDetect && (
                    <button onClick={onDetect} disabled={busy} title="手动跑一轮探测（规则触发 → Claude 闸门 → 引擎执行）；探测每小时也自动跑"
                      className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 active:translate-y-px disabled:opacity-40">
                      探测一轮
                    </button>
                  )}>
                  {signals.length === 0 ? (
                    <EmptyState title="还没有触发记录" hint="探测每小时自动跑（worker_trader）" />
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {signals.map((s: any) => {
                        const ret = s.features?.ret_lookback
                        const hypo = s.hypo_outcome
                        return (
                          <li key={s.id}
                            className={`py-2.5 ${s.trade_id ? 'cursor-pointer transition-colors duration-150 hover:bg-zinc-50' : ''}`}
                            onClick={() => s.trade_id && onOpenTrade(s.trade_id)}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-2xs text-zinc-400">{when(s.created_at)}</span>
                              <span className="text-sm font-medium text-zinc-800">{sym(s.symbol)}</span>
                              <Badge>{SIDE[s.side] ?? s.side}</Badge>
                              <span className="font-mono text-2xs text-zinc-400">{s.setup_key}</span>
                              {ret != null && <span className="font-mono text-2xs text-zinc-500">{netPct(ret, 1)}/回看</span>}
                              <Badge tone={s.verdict === 'confirmed' ? 'hit' : s.verdict === 'vetoed' ? 'miss' : 'neutral'}>
                                {VERDICT[s.verdict] ?? s.verdict ?? '待裁'}
                              </Badge>
                              {s.veto_category && (
                                <span className="text-2xs text-zinc-400">{VETO_CATEGORY[s.veto_category] ?? s.veto_category}</span>
                              )}
                              {s.trade_id && <span className="font-mono text-2xs text-zinc-400">#{s.trade_id}</span>}
                              {hypo && (
                                <span className={`ml-auto font-mono text-2xs ${hypo.avoided_loss ? 'text-verdict-hit' : 'text-verdict-miss'}`}>
                                  假想 {netPct(hypo.hypo_net_return)} · 否决{hypo.avoided_loss ? '对' : '错'}
                                </span>
                              )}
                            </div>
                            {s.reasoning && (
                              <p className="mt-1 text-xs leading-relaxed text-zinc-500" title={s.reasoning}>
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
            )}
          </>
        )
      }}
    </QueryGate>
  )
}
