"""H10 回测：实际利率(10y TIPS)变动 → 黄金/白银 反向漂移，含真 holdout。

预注册见 doc/phase3-H10-gold-realrate-prereg.md。阈值锁死，**不调参**。全新家族（宏观驱动）。
信号 = 过去 30 天实际利率变动符号（反向）；前向 = 30 天金/银方向收益。复用 pit/stats + h3._mixed_null_upper。
确定性、无 Claude。跑：`python -m analyzer.research.h10`
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..db import make_pool
from ..marketstore import GLOBAL
from . import pit, stats
from .h3 import _mixed_null_upper

UNIVERSE = ["XAU/USD", "XAG/USD"]
LOOKBACK = timedelta(days=30)       # 实际利率回看
HORIZONS_D = [15, 30, 60]
PRIMARY_D = 30
DEDUP = timedelta(days=30)
EXIT_TOL = timedelta(days=5)
COST = 0.0010
MIN_N = 40
SPLIT = datetime(2018, 1, 1, tzinfo=timezone.utc)


def _pnl(price: list[pit.Point], signal_ts, d: str, horizon_d: int) -> float | None:
    entry = pit.first_after(price, signal_ts)
    if entry is None or entry[1] <= 0:
        return None
    exit_pt = pit.value_at_or_after(price, entry[0] + timedelta(days=horizon_d), EXIT_TOL)
    if exit_pt is None:
        return None
    ret = exit_pt[1] / entry[1] - 1.0
    return (ret if d == "long" else -ret) - COST


def run_symbol(pool, symbol: str, rate: list[pit.Point], window: tuple | None = None) -> dict:
    price = pit.load_series(pool, symbol, "price")
    if not price or not rate:
        return {"symbol": symbol, "skipped": True}
    since, until = window or (None, None)

    cand = []
    for ts, _ in price:
        if (since and ts < since) or (until and ts >= until):
            continue
        r_now = pit.asof(rate, ts)
        r_past = pit.asof(rate, ts - LOOKBACK)
        if r_now is None or r_past is None:
            continue
        dr = r_now - r_past
        if dr == 0:
            continue
        cand.append((ts, "long" if dr < 0 else "short"))   # 利率降→做多金
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
    rate = pit.load_series(pool, GLOBAL, "real_rate_10y", scope="global")
    per = [run_symbol(pool, s, rate, window) for s in UNIVERSE]
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
        "per": per,
    }
    return {"per_symbol": per, "pooled": p}


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 样本 {ins['n_S']} < {MIN_N}"}
    checks = {
        "②净期望>0且CI下限>0": ins["mean_pnl"] > 0 and ins["ci"][0] > 0,
        "③超随机择时零分布": ins["mean_pnl"] > ins["null_upper"],
        "④命中>50%": ins["hit"] > 0.5,
        "⑤金银均>0": ins["symbols_positive"] >= ins["symbols_total"],
    }
    ho_ok = hold["n_S"] >= 20 and hold["mean_pnl"] > 0
    if all(checks.values()) and ho_ok:
        label = "有戏（in-sample 全过 且 holdout 站住）→ Phase 4 + beta 分解"
    elif all(checks.values()) and not ho_ok:
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（不挪门）"
    elif ins["mean_pnl"] <= 0:
        label = "无 edge（黄金已即时定价实际利率，无滞后）→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _block(tag: str, res: dict) -> None:
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
        ins, hold, full = run(pool, (None, SPLIT)), run(pool, (SPLIT, None)), run(pool, None)
        print("=" * 84)
        print(f"H10：10y 实际利率 30天变动 → 金/银反向 +{PRIMARY_D}天")
        print("=" * 84)
        _block("IN-SAMPLE <2018", ins)
        print("-" * 84)
        _block("HOLDOUT ≥2018", hold)
        print("-" * 84)
        _block("FULL 2008-now", full)
        ap = ins["pooled"]["alt_h"]
        print("  各持有(in-sample,探索)： " + "  ".join(f"{h}d={_f(ap[h])}" for h in HORIZONS_D))
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
