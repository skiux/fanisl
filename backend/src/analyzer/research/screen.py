"""Phase 2 系统化特征筛：全部平稳特征 → 前向收益的 Spearman 秩 IC（无偏、带 FDR 校正）。

补完 Phase 2 的另一半——我此前是"手挑假设逐个测"（H1/H3/H4/H5，有选择偏差）。这里**无偏地**把
现有所有平稳特征对前向收益跑一遍 IC，回答"现有数据里到底有没有任何特征带预测力"。

纪律（蓝图 §6/§141）：
- 无未来函数：特征值用其自身时间戳（当时已知），前向收益只用 t 之后的价格。
- 去重叠：按 horizon 取样（dedup_by_gap），减少重叠样本把显著性灌水。
- 多重检验：~特征×horizon 组的 p 值做 **Benjamini-Hochberg FDR** 校正；存活者只算**候选**，
  须另立预注册 + 样本外确认，**不当作已发现的 edge**。
- 符号一致性：报 ≥4/5 标的同向，单标的带飞的不算。

确定性、无 Claude、纯 stdlib。跑：`python -m analyzer.research.screen`
"""

from __future__ import annotations

from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats

UNIVERSE = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT"]

# 只筛**平稳、点时可用**的特征（排除价格/布林带等 level 与非平稳量、单标的链上量）
FEATURES = [
    "rsi_1h", "rsi_4h", "rsi_1d",
    "macd_hist_1h", "macd_hist_4h", "macd_hist_1d",
    "change_pct_1h", "change_pct_4h", "change_pct_1d",
    "atr_pct_1h", "atr_pct_4h", "atr_pct_1d",
    "vol_ratio_1h", "vol_ratio_4h", "vol_ratio_1d",
    "funding_rate", "oi_usd_1h", "lsr", "top_trader_lsr", "taker_buy_sell_ratio",
    "liq_long_1h", "liq_short_1h", "liq_total_1h",
]

HORIZONS_H = [4, 24]
BAR_TOL = timedelta(minutes=90)

# bar 时点污染隔离区——2026-07-08 已修复并验证为空：backfill.indicator_rows 改为按 bar **收盘**
# 打戳（值已知的时刻），污染行已删除重填，trailing/forward 审计确认干净
# （change_pct_1d 前向相关 0.952→-0.028、change_pct_4h 0.733→-0.026）。
# 集合保留为空作为机制占位：再发现污染特征时加进来即整类隔离；自动守卫（前向>>后向）仍是后盾。
SUSPECT_BAR: set[str] = set()
FDR_Q = 0.10
MIN_N = 60          # 单标的样本下限（去重叠后）
MIN_TOTAL = 150     # 合并样本下限，IC 才进 FDR


def _fwd_return(price: list[pit.Point], t, horizon_h: int) -> float | None:
    """t→t+H 的原始前向收益（非方向、非净）。进场=t 当时价（asof），出场=t+H 容差内首点。"""
    entry = pit.asof(price, t)
    if entry is None or entry <= 0:
        return None
    exit_pt = pit.value_at_or_after(price, t + timedelta(hours=horizon_h), BAR_TOL)
    if exit_pt is None:
        return None
    return exit_pt[1] / entry - 1.0


def _trail_return(price: list[pit.Point], t, horizon_h: int) -> float | None:
    """t−H→t 的后向收益。lookahead 守卫的参照：干净因果特征应与后向相关、与前向弱相关。"""
    pn = pit.asof(price, t)
    pb = pit.asof(price, t - timedelta(hours=horizon_h))
    if pn is None or pb is None or pb <= 0:
        return None
    return pn / pb - 1.0


def _pairs(feat: list[pit.Point], price: list[pit.Point], horizon_h: int):
    """某标的：去重叠取样后的 (特征值, 前向收益, 后向收益) 三元组。dedup 间隔 = horizon。"""
    kept = set(pit.dedup_by_gap([t for t, _ in feat], timedelta(hours=horizon_h)))
    fx, fy, ft = [], [], []
    for t, v in feat:
        if t not in kept:
            continue
        rf = _fwd_return(price, t, horizon_h)
        rt = _trail_return(price, t, horizon_h)
        if rf is None or rt is None:
            continue
        fx.append(v)
        fy.append(rf)
        ft.append(rt)
    return fx, fy, ft


def _pooled_ic(per_symbol: dict, which: int) -> tuple[float, int, list]:
    """which: 1=前向收益, 2=后向收益。各标的内部转秩→[0,1] 并池后算秩 IC + 每标的 IC。"""
    px, py, sym_ics = [], [], []
    for sym, triple in per_symbol.items():
        fx = triple[0]
        fy = triple[which]
        if len(fx) < MIN_N:
            continue
        ic = stats.spearman(fx, fy)
        if ic == ic:
            sym_ics.append((sym, ic))
        rx, ry = stats.ranks(fx), stats.ranks(fy)
        nx = len(fx)
        px += [r / nx for r in rx]
        py += [r / nx for r in ry]
    n = len(px)
    ic = stats.spearman(px, py) if n >= MIN_TOTAL else float("nan")
    return ic, n, sym_ics


def _screen_one(per_symbol: dict, horizon_h: int) -> dict:
    """合并多标的：前向 IC（带 p/符号一致性）+ 后向 IC（lookahead 守卫参照）。"""
    ic, n, sym_ics = _pooled_ic(per_symbol, 1)       # 前向
    ic_tr, _, _ = _pooled_ic(per_symbol, 2)          # 后向（trailing）
    p = stats.corr_pvalue(ic, n) if ic == ic else float("nan")
    same_sign = 0
    if sym_ics and ic == ic:
        same_sign = sum(1 for _, v in sym_ics if (v > 0) == (ic > 0))
    # lookahead 守卫：干净因果特征不可能"预测未来强于反映过去"。
    # 前向 |IC| 明显大于后向 |IC| 且本身不小 → 疑似特征窗口越过 t（污染）。
    leak = (ic == ic and ic_tr == ic_tr
            and abs(ic) > 0.10 and abs(ic) > 1.3 * abs(ic_tr))
    return {"ic": ic, "ic_tr": ic_tr, "p": p, "n": n, "n_sym": len(sym_ics),
            "same_sign": same_sign, "sym_ics": sym_ics, "leak_auto": leak}


def run(pool, universe: list[str] | None = None) -> list[dict]:
    uni = universe or UNIVERSE
    # 预载每标的价格 + 各特征序列
    price = {s: pit.load_series(pool, s, "price") for s in uni}
    rows = []
    for feat in FEATURES:
        series = {s: pit.load_series(pool, s, feat) for s in uni}
        for h in HORIZONS_H:
            per = {}
            for s in uni:
                if series[s] and price[s]:
                    per[s] = _pairs(series[s], price[s], h)
            r = _screen_one(per, h)          # 设 r["leak_auto"]（前向>>后向 自动守卫）
            r.update({"feature": feat, "h": h, "leak_bar": feat in SUSPECT_BAR})
            r["leak"] = r["leak_auto"] or r["leak_bar"]   # 任一成立即剔除出 edge 评判
            rows.append(r)
    # 多重检验 FDR：只在**未被 lookahead 守卫拦下**的特征上做（污染特征不该参与 edge 评判）
    ps = [r["p"] if not r["leak"] else float("nan") for r in rows]
    flags = stats.bh_fdr(ps, q=FDR_Q)
    for r, f in zip(rows, flags):
        r["fdr_sig"] = f
    return rows


def _f(x, d=3):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:+.{d}f}"


def print_report(rows: list[dict]) -> None:
    print("=" * 92)
    print("Phase 2 系统化特征筛：特征 → 前向收益 Spearman 秩 IC（FDR 校正，无偏）")
    print(f"universe={'/'.join(s.split('/')[0] for s in UNIVERSE)}  horizons={HORIZONS_H}h  "
          f"dedup=horizon  FDR q={FDR_Q}")
    print("=" * 92)
    print(f"{'特征':<22}{'h':>3}{'前向IC':>9}{'后向IC':>9}{'p':>8}{'N':>7}{'同向':>6}{'判定':>10}")
    # 按 |前向IC| 降序，便于看最强的
    for r in sorted(rows, key=lambda x: -(abs(x["ic"]) if x["ic"] == x["ic"] else -1)):
        ss = f"{r['same_sign']}/{r['n_sym']}" if r["n_sym"] else "—"
        if r["leak_bar"]:
            tag = "⚠bar时点"
        elif r["leak_auto"]:
            tag = "⚠泄漏"
        elif r.get("fdr_sig"):
            tag = "★候选"
        else:
            tag = ""
        pv = "—" if r["p"] != r["p"] else f"{r['p']:.3f}"
        print(f"{r['feature']:<22}{r['h']:>3}{_f(r['ic']):>9}{_f(r['ic_tr']):>9}"
              f"{pv:>8}{r['n']:>7}{ss:>6}{tag:>10}")
    print("-" * 92)
    auto = sorted({f"{r['feature']}@{r['h']}h" for r in rows if r["leak_auto"]})
    bars = sorted({r["feature"] for r in rows if r["leak_bar"]})
    if auto:
        print(f"⚠ 自动守卫拦下 {len(auto)} 项（前向 IC >> 后向 IC，特征窗口确证越过 t）：{', '.join(auto)}")
    if bars:
        print(f"⚠ 整类剔除 {len(bars)} 个 4h/1d bar 聚合特征（审计确认/疑似 bar 时点污染，前向 IC≈/≥后向 IC）：")
        print(f"  {', '.join(bars)}")
    print("  → 这些 bar 指标存储时点不正确，禁止喂回测/喂 Claude 当'当前值'，须按时点重算后才可用。")
    survivors = [r for r in rows
                 if r.get("fdr_sig") and not r["leak"] and r["n_sym"] and r["same_sign"] >= 4]
    print("-" * 92)
    print(f"干净（非泄漏）+ FDR 显著 + ≥4/5 标的同向的候选：{len(survivors)} 个")
    for r in survivors:
        sign = "动量(高→涨)" if r["ic"] > 0 else "反转(高→跌)"
        print(f"  {r['feature']} @+{r['h']}h  前向IC={_f(r['ic'])}  同向 {r['same_sign']}/{r['n_sym']}  → {sign}")
    if not survivors:
        print("  无。剔除泄漏后，现有平稳特征里没有任何一个在 FDR + 标的一致性下展现稳健前向预测力。")
        print("  → 无偏地复证了 H1/H3/H4/H5：现有数据无简单 edge。")
    print("=" * 92)


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        print_report(run(pool))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
