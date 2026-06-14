"""H9 回测：财报后漂移 PEAD（美股，市场中性），含真 holdout。

预注册见 doc/phase3-H9-pead-prereg.md。阈值锁死，**不调参**。数据无 key：Yahoo 复权价 + EDGAR 备案日。
surprise = 公告窗口相对 SPY 的市场调整 CAR（不需一致预期）；漂移 = 进场后 40 交易日的市场调整收益。
复用 pit/stats + h3._mixed_null_upper。确定性、无 Claude。跑：`python -m analyzer.research.h9`
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import _mixed_null_upper

EQUITY = ["NVDA", "AAPL", "TSLA", "MSFT", "META", "AMZN", "GOOGL", "COIN", "MSTR", "MU"]
BENCH = "SPY"
SURPRISE_BARS = 5          # 公告窗口（交易日）：t 含往前 5 根的市场调整 CAR
DRIFT_BARS = [20, 40, 60]
PRIMARY = 40               # 主漂移窗（交易日）
DEDUP = timedelta(days=25)
COST = 0.0015              # 市场中性对，两腿 ~15bps
MIN_N = 40
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)
SYM_POS_FRAC = 0.60


def _spy_by_date(pool) -> dict:
    return {t.date(): c for t, c in pit.load_series(pool, BENCH, "price")}


def _car(px: list, spy: dict, j: int) -> float | None:
    """市场调整 CAR：第 j 根（含）往前 SURPRISE_BARS 个日收益的 Σ(个股−SPY)。无未来函数。"""
    if j - SURPRISE_BARS < 0:
        return None
    s = 0.0
    for k in range(j - SURPRISE_BARS + 1, j + 1):
        d0, d1 = px[k - 1][0].date(), px[k][0].date()
        if d0 not in spy or d1 not in spy or px[k - 1][1] <= 0 or spy[d0] <= 0:
            return None
        s += (px[k][1] / px[k - 1][1] - 1.0) - (spy[d1] / spy[d0] - 1.0)
    return s


def _drift_pnl(px: list, spy: dict, entry_i: int, d: str, bars: int) -> float | None:
    """市场中性漂移 PnL：进场 entry_i、出场 entry_i+bars 的 (个股−SPY) 收益，按方向，扣成本。"""
    xi = entry_i + bars
    if xi >= len(px):
        return None
    de, dx = px[entry_i][0].date(), px[xi][0].date()
    if de not in spy or dx not in spy or px[entry_i][1] <= 0 or spy[de] <= 0:
        return None
    rel = (px[xi][1] / px[entry_i][1] - 1.0) - (spy[dx] / spy[de] - 1.0)
    return (rel if d == "long" else -rel) - COST


def run_symbol(pool, symbol: str, spy: dict, window: tuple | None = None) -> dict:
    px = pit.load_series(pool, symbol, "price")
    events = [t for t, _ in pit.load_series(pool, symbol, "earn_filing")]
    if not px or not events:
        return {"symbol": symbol, "skipped": True}
    since, until = window or (None, None)
    bar_ts = [p[0] for p in px]
    from bisect import bisect_right

    s_pnl = {b: [] for b in DRIFT_BARS}
    n_long = n_short = 0
    last_ts = None
    for ev in events:
        if (since and ev < since) or (until and ev >= until):
            continue
        if last_ts is not None and ev - last_ts < DEDUP:
            continue
        entry_i = bisect_right(bar_ts, ev)          # 首根 ts>ev = 次交易日进场
        if entry_i >= len(px):
            continue
        car = _car(px, spy, entry_i - 1)            # 公告窗口截至 ev 当根(entry_i-1)
        if car is None or car == 0:
            continue
        d = "long" if car > 0 else "short"
        last_ts = ev
        n_long += d == "long"
        n_short += d == "short"
        for b in DRIFT_BARS:
            v = _drift_pnl(px, spy, entry_i, d, b)
            if v is not None:
                s_pnl[b].append(v)

    # 无条件方向漂移池（随机择时零分布）：每根当进场
    pool_long, pool_short = [], []
    for i in range(len(px)):
        if (since and px[i][0] < since) or (until and px[i][0] >= until):
            continue
        v = _drift_pnl(px, spy, i, "long", PRIMARY)
        if v is not None:
            pool_long.append(v)
            pool_short.append(-v - 2 * COST)        # 反向同根：-(rel)-COST，rel=v+COST
    return {"symbol": symbol, "n_long": n_long, "n_short": n_short,
            "s_pnl": s_pnl, "pool_long": pool_long, "pool_short": pool_short}


def run(pool, window: tuple | None = None) -> dict:
    spy = _spy_by_date(pool)
    per = [run_symbol(pool, s, spy, window) for s in EQUITY]
    per = [r for r in per if not r.get("skipped")]
    S = [x for r in per for x in r["s_pnl"][PRIMARY]]
    n_long = sum(r["n_long"] for r in per)
    n_short = sum(r["n_short"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    sym_pos = sum(1 for r in per if r["s_pnl"][PRIMARY] and stats.mean(r["s_pnl"][PRIMARY]) > 0)
    p = {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "symbols_positive": sym_pos, "symbols_total": len(per),
        "alt_h": {b: stats.mean([x for r in per for x in r["s_pnl"][b]]) for b in DRIFT_BARS},
    }
    return {"per_symbol": per, "pooled": p}


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 样本 {ins['n_S']} < {MIN_N}"}
    checks = {
        "②净期望>0且CI下限>0": ins["mean_pnl"] > 0 and ins["ci"][0] > 0,
        "③超随机择时零分布": ins["mean_pnl"] > ins["null_upper"],
        "④命中>50%": ins["hit"] > 0.5,
        f"⑤≥60%标的正": ins["symbols_positive"] >= SYM_POS_FRAC * ins["symbols_total"],
    }
    ho_ok = hold["n_S"] >= 20 and hold["mean_pnl"] > 0
    if all(checks.values()) and ho_ok:
        label = "有戏（in-sample 全过 且 holdout 站住）→ Phase 4 前向"
    elif all(checks.values()) and not ho_ok:
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（过拟合/regime 依赖，不挪判据）"
    elif ins["mean_pnl"] <= 0:
        label = "无 edge（PEAD 在这批股/本设定不成立）→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _block(tag: str, res: dict) -> None:
    p = res["pooled"]
    print(f"  [{tag}] 事件 {p['n_S']}（多 {p['n_long']}/空 {p['n_short']}）  净={_f(p['mean_pnl'])}  "
          f"CI下限={_f(p['ci'][0])}  零分布上限={_f(p['null_upper'])}  命中={_f(p['hit'],3)}  "
          f"标的正 {p['symbols_positive']}/{p['symbols_total']}")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins, hold, full = run(pool, (None, SPLIT)), run(pool, (SPLIT, None)), run(pool, None)
        print("=" * 84)
        print(f"H9：PEAD 财报后漂移（公告 5d CAR → 顺势 +{PRIMARY} 交易日，市场中性）[美股]")
        print("=" * 84)
        _block("IN-SAMPLE <2019", ins)
        print("-" * 84)
        _block("HOLDOUT ≥2019", hold)
        print("-" * 84)
        _block("FULL 2010-now", full)
        ap = ins["pooled"]["alt_h"]
        print("  各漂移(in-sample,探索)： " + "  ".join(f"{b}d={_f(ap[b])}" for b in DRIFT_BARS))
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
