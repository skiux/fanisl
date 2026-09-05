import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import {
  deleteCostBasis, fetchPortfolio, listCostBasis, readScenario, setCostBasis,
  type Scenario,
} from '../../api/client'
import { getSession } from '../../api/session'
import { cn } from '../../lib/cn'
import { amount, price, signedMoney } from '../../lib/format'
import { PortfolioError } from '../../api/types'
import type {
  CostBasisEntry, PortfolioSnapshot, SourceKey, SpotCostRow,
} from '../../api/types'
import { Masthead } from './Masthead'
import { PermissionState } from './states'

/**
 * 现货成本。**只有管理员能进。**
 *
 * ## 为什么要人手填
 *
 * 现货未实现盈亏来自成交重放（`myTrades`），可有几条进账的路它照不到：钱包划转、
 * 理财派息、小额兑换、闪兑，以及 90 天以前的充值——那个接口再也查不回来。
 * 缺的是历史，不是算法。重放于是报"成本不明"，那部分不计入盈亏，屏幕上的数就偏小。
 *
 * 这一页让知道的人把均价直接报出来：
 *
 *     未实现 = 持有量 × (现价 − 录入均价)
 *
 * 持有量仍然取自接口（**跨全部钱包**，划进合约当保证金的那部分也算），
 * 只有均价是手填的。填了就整仓按它算，取代重放的均价。
 *
 * **已实现不受影响**——一个当前的均价回答不了过去那些卖出是赚是赔。
 *
 * ## 会过期
 *
 * 加仓之后录的均价就不对了，而它不会自己报警。所以录入时把当时的持有量一并存下，
 * 这一页拿它跟现在的持有量比，对不上就在那一行说出来。
 */
export function CostBasisPage() {
  const session = getSession()
  const isAdmin = session.status === 'authenticated' && session.user.role === 'admin'

  // 场景在这一页不可切（报头没有开关），进来时读一次就够
  const [scenario] = useState(readScenario)
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [entries, setEntries] = useState<CostBasisEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setFailed(false)
    try {
      // 两边一起取：光有录入记录看不出效果，光有持仓看不出哪几行是手填的
      const [snap, rows] = await Promise.all([
        fetchPortfolio(scenario), listCostBasis(scenario),
      ])
      setSnapshot(snap)
      setEntries(rows)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof PortfolioError
        ? e.message : '读取失败')
      // 失败也要落地：不置位的话，下面永远停在"正在读取…"，
      // 屏幕上同时挂着一条错误和一个转不完的等待，读着像还有救
      setSnapshot(null)
      setEntries(null)
      setFailed(true)
    }
  }, [scenario])

  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof PortfolioError
        ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      {/* 内容不多，纸张按内容收——钉在视口高度只会在下面留一大片空白 */}
      <div className="sheet mx-auto flex max-w-[1420px] flex-col">
        <Masthead asOf={snapshot?.as_of ?? null} onRefresh={() => { void load() }}
                  page="costbasis" refreshing={busy} sources={[]} title="现货成本" />

        {!isAdmin ? (
          <div className="px-6 sm:px-10">
            <PermissionState message="现货成本只对管理员开放。" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8">
            <div className="rise">
              {error && (
                <p className="mb-6 rounded-[var(--radius-control)] border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs text-loss"
                   role="alert">
                  {error}
                </p>
              )}
              {!failed && <Body busy={busy} entries={entries} onAct={act}
                                scenario={scenario} snapshot={snapshot} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 窄屏两列三行：标的|持有量 / 现价|未实现 / 均价占满一行。
// 现价在窄屏**不能藏**——要填的就是相对现价的成本，藏了这一页在手机上没法用。
// 宽屏五列一行，均价与未实现用显式列号换位（DOM 顺序是按窄屏排的）。
// 现货持仓来自这几个钱包（价格是公开端点，没有 key 也照常返回，不能拿它当判据）
const HOLDING_SOURCES: SourceKey[] = ['spot', 'wallets', 'futures', 'margin', 'earn']

const ROW = cn('grid grid-cols-2 items-baseline gap-x-4 gap-y-1.5',
               'sm:grid-cols-[9rem_1fr_1fr_13rem_1fr] sm:gap-y-0')

function Body({ snapshot, entries, busy, onAct, scenario }: {
  snapshot: PortfolioSnapshot | null
  entries: CostBasisEntry[] | null
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
  scenario: Scenario
}) {
  if (snapshot === null || entries === null) {
    return <p className="py-10 text-sm text-ink-3">正在读取…</p>
  }

  const byAsset = new Map(entries.map((entry) => [entry.asset, entry]))
  // 稳定币不在这里：USDT 的成本恒等于面值，给它填均价没有意义
  const holdings = (snapshot.pnl?.spot_assets ?? []).filter((row) => !row.is_cash && row.qty > 0)
  // 已经清仓、但还留着一条录入记录的币也要列出来，否则删不掉
  const orphans = entries.filter((entry) => !holdings.some((row) => row.asset === entry.asset))

  if (holdings.length === 0 && orphans.length === 0) {
    // "空账户"与"取不到"是两件事。混成一句的话，没配 key 会被说成"账户里没有币"，
    // 方向指反了——资产页上同一个错犯过一次。判据是**持仓那几个来源的状态**，
    // 不是"有没有数"：空账户与取不到都给不出数。
    const blind = snapshot.sources.some(
      (source) => HOLDING_SOURCES.includes(source.key) && source.status !== 'ok')
    return (
      <p className="py-10 text-sm text-ink-3">
        {blind ? '持仓取不到，没有可以配置的标的。' : '账户里还没有现货持仓。'}
      </p>
    )
  }

  // 成本不明的排前面：它们才是这一页要解决的，而且它们的数字现在是错的
  const sorted = [...holdings].sort((a, b) => {
    const gap = Number(b.unpriced_qty > 0) - Number(a.unpriced_qty > 0)
    return gap !== 0 ? gap : (b.value_usd ?? 0) - (a.value_usd ?? 0)
  })

  return (
    <>
      <div className={cn(ROW, 'label hidden border-b border-rule pb-2 sm:grid')}>
        <span>标的</span>
        <span>持有量</span>
        <span>现价</span>
        <span>持仓均价</span>
        <span className="text-right">未实现</span>
      </div>

      <ul className="divide-y divide-rule">
        {sorted.map((row) => (
          <Row busy={busy} entry={byAsset.get(row.asset)} key={row.asset}
               onAct={onAct} row={row} scenario={scenario} />
        ))}
        {orphans.map((entry) => (
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3.5"
              key={entry.asset}>
            <span className="text-sm text-ink-2">{entry.asset}</span>
            <span className="text-xs text-ink-3">已不在持仓里</span>
            <button className={ACTION} disabled={busy}
                    onClick={() => onAct(() => deleteCostBasis(scenario, entry.asset))} type="button">
              清除
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

const ACTION = cn(
  'whitespace-nowrap text-xs text-ink-3 outline-none transition-colors duration-200',
  'hover:text-ink disabled:opacity-40',
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2',
  'focus-visible:outline-accent',
)

function Row({ row, entry, busy, onAct, scenario }: {
  row: SpotCostRow
  entry: CostBasisEntry | undefined
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
  scenario: Scenario
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  const manual = row.cost_source === 'manual'
  // 录入之后加过仓：那时的持有量跟现在对不上，这条均价已经不管整仓了
  const stale = manual && entry?.qty_at_entry != null
    && Math.abs(entry.qty_at_entry - row.qty) > row.qty * 1e-6

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const value = Number(draft)
    if (!Number.isFinite(value) || value <= 0) return
    setEditing(false)
    void onAct(() => setCostBasis(scenario, row.asset,
                                  { avg_cost_usd: value, qty_at_entry: row.qty }))
  }

  return (
    <li className={cn(ROW, 'py-3.5')}>
      <div className="min-w-0">
        <div className="text-sm text-ink">{row.asset}</div>
        {/* 徽章自成一行且不换行：跟币种代码挤在一行的话，「成本不明」会从词中间断开 */}
        {row.unpriced_qty > 0 && (
          <div className="tnum whitespace-nowrap text-micro text-loss">
            {amount(row.unpriced_qty)} 成本不明
          </div>
        )}
        {stale && (
          <div className="whitespace-nowrap text-micro text-accent">持有量变了</div>
        )}
      </div>

      <span className="tnum text-right text-sm text-ink-2 sm:text-left">
        {amount(row.qty)}
      </span>
      <span className="tnum text-sm text-ink-2">{price(row.price_usd)}</span>

      <span className={cn('tnum text-right text-sm sm:col-start-5 sm:row-start-1',
        row.unrealized_usd === null ? 'text-ink-3'
          : row.unrealized_usd >= 0 ? 'text-gain' : 'text-loss')}>
        {row.unrealized_usd === null ? '—' : signedMoney(row.unrealized_usd)}
      </span>

      <div className="col-span-2 sm:col-span-1 sm:col-start-4 sm:row-start-1">
        {editing ? (
          <form className="flex items-center gap-2" onSubmit={submit}>
            {/* type="text" 而不是 number：数字框那对上下箭头在这套纸面语言里很突兀，
                而它带来的校验这里本来就要自己做一遍（亚分币要 8 位小数，step 管不住）。
                inputMode 让手机照样弹数字键盘。 */}
            <input
              aria-label={`${row.asset} 的持仓均价（美元）`}
              autoFocus
              className="min-w-0 flex-1 border-b border-rule-strong bg-transparent pb-1 text-sm text-ink outline-none placeholder:text-ink-3 sm:max-w-[8rem]"
              inputMode="decimal"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="美元"
              required
              type="text"
              value={draft}
            />
            <button className={ACTION} disabled={busy} type="submit">保存</button>
            <button className={ACTION} onClick={() => setEditing(false)} type="button">取消</button>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            {/* 窄屏没有表头，而这一行和上面的现价都是一个美元数——不标就分不出谁是谁 */}
            <span className="label sm:hidden">均价</span>
            <span className={cn('tnum text-sm', manual ? 'text-ink' : 'text-ink-3')}>
              {price(row.avg_cost_usd)}
            </span>
            <button
              className={ACTION}
              disabled={busy}
              onClick={() => {
                setDraft(row.avg_cost_usd === null ? '' : String(row.avg_cost_usd))
                setEditing(true)
              }}
              type="button"
            >
              {manual ? '改' : '录入'}
            </button>
            {manual && (
              // 清除是退回成交重放的口径，不是退回"没有盈亏"
              <button className={ACTION} disabled={busy}
                      onClick={() => onAct(() => deleteCostBasis(scenario, row.asset))} type="button">
                清除
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
