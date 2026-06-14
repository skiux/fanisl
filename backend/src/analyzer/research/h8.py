"""H8 回测：COT 管理基金持仓极值 → 反转（金/银/油），含真 holdout。

预注册见 doc/phase3-H8-cot-positioning-prereg.md。阈值锁死，**不调参**。
多资产扩张第一个切片；第一次能做跨 regime holdout（COT+价回溯到 2006/2008）。
复用 pit/stats，随机零分布复用 h3._mixed_null_upper。确定性、无 Claude。
跑：`python -m analyzer.research.h8`
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import _mixed_null_upper

UNIVERSE = ["XAU/USD", "XAG/USD", "CL"]
PCT_WINDOW = timedelta(days=1095)   # 滚动 3 年分位
HI, LO = 0.90, 0.10                 # 拥挤多 → fade short / 拥挤空 → fade long
DEDUP = timedelta(weeks=4)          # = 主持有，样本不重叠
HORIZONS_D = [7, 14, 28]
PRIMARY_D = 28
EXIT_TOL = timedelta(days=5)        # 日线 + 周末
COST = 0.0010                       # 金/油期货往返 ~10bps
MIN_N = 40
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)   # in-sample / holdout 分界
SYM_POS = 2                         # ⑤ ≥2/3 标的正


def _pnl(price: list[pit.Point], signal_ts: datetime, d: str, horizon_d: int) -> float | None:
    """净方向 PnL：进场=信号后第一根日线，出场=进场+horizon（容差内），扣成本。"""
    entry = pit.first_after(price, signal_ts)
    if entry is None or entry[1] <= 0:
        return None
    exit_pt = pit.value_at_or_after(price, entry[0] + timedelta(days=horizon_d), EXIT_TOL)
    if exit_pt is None:
        return None
    ret = exit_pt[1] / entry[1] - 1.0
    return (ret if d == "long" else -ret) - COST


def _mm_net_pct_series(pool, symbol: str) -> list[pit.Point]:
    """构造 管理基金净/OI 的点时序列（COT 发布时刻打戳）。"""
    net = pit.load_series(pool, symbol, "cot_mm_net")
    oi = dict(pit.load_series(pool, symbol, "cot_oi"))
    return [(t, v / oi[t]) for t, v in net if t in oi and oi[t] > 0]


def run_symbol(pool, symbol: str, window: tuple | None = None) -> dict:
    series = _mm_net_pct_series(pool, symbol)
    price = pit.load_series(pool, symbol, "price")
    if not series or not price:
        return {"symbol": symbol, "skipped": True}
    since, until = window or (None, None)

    cand = []
    for ts, _ in series:
        if (since and ts < since) or (until and ts >= until):
            continue
        p = pit.tw_percentile_at(series, ts, PCT_WINDOW)
        if p is None:
            continue
        if p >= HI:
            cand.append((ts, "short"))
        elif p <= LO:
            cand.append((ts, "long"))
    trig = []
    for ts, d in cand:
        if not trig or ts - trig[-1][0] >= DEDUP:
            trig.append((ts, d))

    s_pnl = {h: [] for h in HORIZONS_D}
    n_long = n_short = 0
    for ts, d in trig:
        n_long += d == "long"
        n_short += d == "short"
        for h in HORIZONS_D:
            v = _pnl(price, ts, d, h)
            if v is not None:
                s_pnl[h].append(v)

    # 无条件方向 PnL 池（随机择时零分布用）：每个价格点当进场
    pool_long, pool_short = [], []
    for tp, _ in price:
        if (since and tp < since) or (until and tp >= until):
            continue
        e = pit.value_at_or_after(price, tp + timedelta(days=PRIMARY_D), EXIT_TOL)
        a = pit.asof(price, tp)
        if e and a and a > 0:
            r = e[1] / a - 1.0
            pool_long.append(r - COST)
            pool_short.append(-r - COST)

    return {"symbol": symbol, "n_triggers": len(trig), "n_long": n_long, "n_short": n_short,
            "s_pnl": s_pnl, "pool_long": pool_long, "pool_short": pool_short}


def run(pool, window: tuple | None = None) -> dict:
    per = [run_symbol(pool, s, window) for s in UNIVERSE]
    per = [r for r in per if not r.get("skipped")]
    S = [x for r in per for x in r["s_pnl"][PRIMARY_D]]
    n_long = sum(r["n_long"] for r in per)
    n_short = sum(r["n_short"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    sym_pos = sum(1 for r in per if r["s_pnl"][PRIMARY_D] and stats.mean(r["s_pnl"][PRIMARY_D]) > 0)
    p = {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "symbols_positive": sym_pos, "symbols_total": len(per),
        "alt_h": {h: stats.mean([x for r in per for x in r["s_pnl"][h]]) for h in HORIZONS_D},
    }
    return {"per_symbol": per, "pooled": p}


def _verdict(insample: dict, holdout: dict) -> dict:
    p = insample
    if p["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 样本 {p['n_S']} < {MIN_N}"}
    checks = {
        "②净期望>0且CI下限>0": p["mean_pnl"] > 0 and p["ci"][0] > 0,
        "③超随机择时零分布": p["mean_pnl"] > p["null_upper"],
        "④命中>50%": p["hit"] > 0.5,
        f"⑤≥{SYM_POS}/3标的正": p["symbols_positive"] >= SYM_POS,
    }
    ho_ok = holdout["n_S"] >= 20 and holdout["mean_pnl"] > 0
    if all(checks.values()) and ho_ok:
        label = "有戏（in-sample 全过 且 holdout 站住）→ Phase 4 前向"
    elif all(checks.values()) and not ho_ok:
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（过拟合/regime 依赖，不得挪判据）"
    elif p["mean_pnl"] <= 0:
        label = "无 edge（COT 极值反转在金银油也不成立）→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _print_block(tag: str, res: dict) -> None:
    p = res["pooled"]
    print(f"  [{tag}] 触发 {p['n_S']}（多 {p['n_long']}/空 {p['n_short']}）  净={_f(p['mean_pnl'])}  "
          f"CI下限={_f(p['ci'][0])}  零分布上限={_f(p['null_upper'])}  命中={_f(p['hit'],3)}  "
          f"标的正 {p['symbols_positive']}/{p['symbols_total']}")
    for r in res["per_symbol"]:
        sp = r["s_pnl"][PRIMARY_D]
        print(f"      {r['symbol']:<9} 触发 {r['n_triggers']:>3}（{r['n_long']}/{r['n_short']}）  "
              f"净={_f(stats.mean(sp))}  命中={_f(stats.hit_rate(sp),2)}")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins = run(pool, (None, SPLIT))
        hold = run(pool, (SPLIT, None))
        full = run(pool, None)
        print("=" * 84)
        print(f"H8：COT 管理基金净/OI 滚动3y 分位 ≥{HI}/≤{LO} → fade，+{PRIMARY_D//7}周  [金/银/油]")
        print("=" * 84)
        _print_block("IN-SAMPLE <2019", ins)
        print("-" * 84)
        _print_block("HOLDOUT ≥2019", hold)
        print("-" * 84)
        _print_block("FULL 2006-now", full)
        ap = ins["pooled"]["alt_h"]
        print(f"  各持有(in-sample,探索)： " + "  ".join(f"{h//7}w={_f(ap[h])}" for h in HORIZONS_D))
        print("-" * 84)
        v = _verdict(ins["pooled"], hold["pooled"])
        if "checks" in v:
            print(f"  [{'PASS' if ins['pooled']['n_S']>=MIN_N else 'FAIL'}] ①in-sample 样本≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] holdout 净期望>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 84)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
