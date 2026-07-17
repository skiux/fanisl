import { useState } from 'react'
import { manualOpen } from '../../api'
import { Panel } from '../ui'

// 实盘镜像录入：全站唯一的写入口（DESIGN.md R13）。把实盘刚下的单登记进评测台，Claude 不介入。
// setup_key 是你自己的 setup 标签——scorecard 按它聚合，量化"我的哪类 setup 有 edge"。
export default function ManualPanel({ account, symbols, onDone }: {
  account: string
  symbols: string[]
  onDone: (msg: string) => void
}) {
  const [f, setF] = useState({
    symbol: 'CL', side: 'long', setup_key: '', entry_type: 'market',
    entry_price: '', sl_price: '', tp_price: '', risk_pct: '1.0', leverage: '2', thesis: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))

  const submit = async () => {
    if (!f.setup_key.trim() || !f.entry_price || !f.sl_price) {
      setErr('setup 标签、进场价、止损价必填'); return
    }
    setErr(null)
    setBusy(true)
    try {
      const r = await manualOpen({
        symbol: f.symbol.trim(), side: f.side, setup_key: f.setup_key.trim(),
        entry_type: f.entry_type, entry_price: Number(f.entry_price),
        sl_price: Number(f.sl_price), tp_price: f.tp_price ? Number(f.tp_price) : null,
        risk_pct: Number(f.risk_pct) || 1.0, leverage: Number(f.leverage) || 2.0,
        thesis: f.thesis.trim() || null,
      }, account)
      if (r.rejected) setErr(`未录入：${r.reason ?? (r.issues || []).join('；')}`)
      else {
        onDone(`已录入 #${r.trade_id}（${f.setup_key}）`)
        setF((s) => ({ ...s, entry_price: '', sl_price: '', tp_price: '', thesis: '' }))
      }
    } catch (e: any) { setErr(`失败：${e.message || e}`) }
    finally { setBusy(false) }
  }

  const inp = 'w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none transition-colors duration-150 focus:border-zinc-400'
  const lab = 'mb-1 block text-2xs uppercase tracking-wide text-zinc-400'

  return (
    <Panel title="录入实盘交易（镜像 · Claude 不介入）"
      right={<span className="text-2xs text-zinc-400">按 setup 标签聚合评测你的酌情 edge</span>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
        <div>
          <label className={lab}>标的</label>
          <input className={inp} list="manual-syms" value={f.symbol} onChange={(e) => set('symbol', e.target.value)} />
          <datalist id="manual-syms">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className={lab}>方向</label>
          <select className={inp} value={f.side} onChange={(e) => set('side', e.target.value)}>
            <option value="long">做多</option><option value="short">做空</option>
          </select>
        </div>
        <div>
          <label className={lab}>setup 标签 *</label>
          <input className={inp} placeholder="如 eia_fade" value={f.setup_key} onChange={(e) => set('setup_key', e.target.value)} />
        </div>
        <div>
          <label className={lab}>进场价 *</label>
          <input className={inp} inputMode="decimal" value={f.entry_price} onChange={(e) => set('entry_price', e.target.value)} />
        </div>
        <div>
          <label className={lab}>止损 *</label>
          <input className={inp} inputMode="decimal" value={f.sl_price} onChange={(e) => set('sl_price', e.target.value)} />
        </div>
        <div>
          <label className={lab}>止盈（可空）</label>
          <input className={inp} inputMode="decimal" value={f.tp_price} onChange={(e) => set('tp_price', e.target.value)} />
        </div>
        <div>
          <label className={lab}>风险 %</label>
          <input className={inp} inputMode="decimal" value={f.risk_pct} onChange={(e) => set('risk_pct', e.target.value)} />
        </div>
        <div>
          <label className={lab}>杠杆</label>
          <input className={inp} inputMode="decimal" value={f.leverage} onChange={(e) => set('leverage', e.target.value)} />
        </div>
        <div className="flex items-end">
          <button onClick={submit} disabled={busy}
            className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-700 active:translate-y-px disabled:opacity-40">
            录入
          </button>
        </div>
      </div>
      <div className="mt-2">
        <input className={inp} placeholder="一句话逻辑（可选，便于复盘）" value={f.thesis} onChange={(e) => set('thesis', e.target.value)} />
      </div>
      {err && <p className="mt-2 text-sm text-verdict-miss">{err}</p>}
      <p className="mt-2 text-2xs leading-relaxed text-zinc-400">
        market = 引擎按当前价成交（进场价作参考）；limit = 挂单等触价。实盘平仓后在持仓表点「平仓」同步；
        止损/止盈由引擎按你给的位自动执行。评测口径与其它账户一致（bh 基准/反事实/按 setup 聚合）。
      </p>
    </Panel>
  )
}
