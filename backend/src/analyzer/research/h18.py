"""H18 回测：EIA 周度原油库存 surprise → WTI 发布后 +3 交易日漂移（事件研究）。

预注册见 doc/phase3-H18-eia-inventory-prereg.md。判据锁死，**不调参**。
消息面方向第一个切片；surprise = Δ库存 vs 季节性朴素期望（ISO 周 ±1 × 过去 5 年），
z 阈值 1.0，方向 = 累库超预期 short / 去库超预期 long。
复用 pit/stats，随机零分布复用 h3._mixed_null_upper。确定性、无 Claude。
跑：`python -m analyzer.research.h18`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from statistics import stdev

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import _mixed_null_upper

SYMBOL = "CL"
METRIC = "eia_crude_stocks"
PUB_LAG = timedelta(days=5)        # 发布 ts − 5 天 = period（周五），回填时的构造反推
GAP_MAX_D = 10                     # 相邻 period 间隔超过此天数 → 非标准周变动，丢弃
SEASONAL_YEARS = 5                 # 季节期望回看的自然年数
WEEK_TOL = 1                       # ISO 周号 ±1
MIN_SEASONAL = 5                   # 季节样本数下限
Z_TH = 1.0                         # |z| 阈值（锁死不调参）
HORIZONS = [1, 3, 5]               # 交易日（价格行索引步进）
PRIMARY_H = 3
COST = 0.0010                      # 往返 10bps，与 H8 油一致
MIN_N = 100
HOLDOUT_MIN_N = 20
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)

Event = tuple[datetime, date, float]   # (publish_ts, period_end, Δinv)


def build_events(series: list[pit.Point]) -> list[Event]:
    """相邻两次发布 → Δ库存事件（打在后一次的发布 ts 上）。period 缺口过大则丢弃。"""
    out: list[Event] = []
    for (t0, v0), (t1, v1) in zip(series, series[1:]):
        p0 = (t0 - PUB_LAG).date()
        p1 = (t1 - PUB_LAG).date()
        if (p1 - p0).days > GAP_MAX_D:
            continue
        out.append((t1, p1, v1 - v0))
    return out


def seasonal_z(events: list[Event], i: int) -> float | None:
    """第 i 个事件的季节 z：期望 = 过去 SEASONAL_YEARS 个自然年、ISO 周号 ±WEEK_TOL
    的 Δinv 均值。只用更早年份（发布必然早于当前）——无未来函数。"""
    _, p, d = events[i]
    wk = p.isocalendar()[1]
    samp = []
    for _, q, dv in events:
        if not (p.year - SEASONAL_YEARS <= q.year <= p.year - 1):
            continue
        wd = abs(q.isocalendar()[1] - wk)
        if min(wd, 53 - wd) <= WEEK_TOL:
            samp.append(dv)
    if len(samp) < MIN_SEASONAL:
        return None
    sd = stdev(samp)
    if sd <= 0:
        return None
    return (d - stats.mean(samp)) / sd


def event_pnl(price: list[pit.Point], publish_ts: datetime, direction: str, h: int) -> float | None:
    """进场 = 发布 ts 之后严格第一根日线；出场 = 进场 + h 个交易日（行索引步进）；扣成本。"""
    ts = [p[0] for p in price]
    i = bisect_right(ts, publish_ts)
    if i >= len(price) or i + h >= len(price):
        return None
    entry, exit_ = price[i][1], price[i + h][1]
    if entry <= 0:
        return None
    ret = exit_ / entry - 1.0
    return (ret if direction == "long" else -ret) - COST


def _pools(price: list[pit.Point], window: tuple, h: int) -> tuple[list[float], list[float]]:
    """随机择时零分布的无条件池：每个日线行做进场，±h 交易日方向收益，扣同成本。"""
    since, until = window
    pool_long, pool_short = [], []
    for i in range(len(price) - h):
        t = price[i][0]
        if (since and t < since) or (until and t >= until):
            continue
        if price[i][1] <= 0:
            continue
        ret = price[i + h][1] / price[i][1] - 1.0
        pool_long.append(ret - COST)
        pool_short.append(-ret - COST)
    return pool_long, pool_short


def run(pool, window: tuple = (None, None)) -> dict:
    inv = pit.load_series(pool, SYMBOL, METRIC)
    price = pit.load_series(pool, SYMBOL, "price")
    events = build_events(inv)
    since, until = window

    s_pnl: dict[int, list[float]] = {h: [] for h in HORIZONS}
    all_sign: list[float] = []      # 探索：不设阈值的全事件符号交易（不判）
    n_long = n_short = 0
    for i, (ts, _p, _d) in enumerate(events):
        if (since and ts < since) or (until and ts >= until):
            continue
        z = seasonal_z(events, i)
        if z is None:
            continue
        d = "short" if z > 0 else "long"
        v_all = event_pnl(price, ts, d, PRIMARY_H)
        if v_all is not None:
            all_sign.append(v_all)
        if abs(z) < Z_TH:
            continue
        n_long += d == "long"
        n_short += d == "short"
        for h in HORIZONS:
            v = event_pnl(price, ts, d, h)
            if v is not None:
                s_pnl[h].append(v)

    pool_long, pool_short = _pools(price, window, PRIMARY_H)
    S = s_pnl[PRIMARY_H]
    return {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "alt_h": {h: stats.mean(s_pnl[h]) for h in HORIZONS},
        "alt_n": {h: len(s_pnl[h]) for h in HORIZONS},
        "all_sign_mean": stats.mean(all_sign), "all_sign_n": len(all_sign),
    }


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 样本 {ins['n_S']} < {MIN_N}"}
    checks = {
        "②净期望>0且CI下限>0": ins["mean_pnl"] > 0 and ins["ci"][0] > 0,
        "③超随机择时零分布": ins["mean_pnl"] > ins["null_upper"],
        "④命中>50%": ins["hit"] > 0.5,
    }
    ho_ok = hold["n_S"] >= HOLDOUT_MIN_N and hold["mean_pnl"] > 0
    if all(checks.values()) and ho_ok:
        label = "有戏（in-sample 全过 且 holdout 站住）→ Phase 4 前向"
    elif all(checks.values()):
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（不得挪判据）"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _print_block(tag: str, r: dict) -> None:
    print(f"  [{tag}] 触发 {r['n_S']}（多 {r['n_long']}/空 {r['n_short']}）  净={_f(r['mean_pnl'])}  "
          f"CI下限={_f(r['ci'][0])}  零分布上限={_f(r['null_upper'])}  命中={_f(r['hit'],3)}")
    print(f"      各持有(探索)： " + "  ".join(
        f"+{h}d={_f(r['alt_h'][h])}(n={r['alt_n'][h]})" for h in HORIZONS))
    print(f"      全事件符号交易(探索,不判)： 净={_f(r['all_sign_mean'])} (n={r['all_sign_n']})")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins = run(pool, (None, SPLIT))
        hold = run(pool, (SPLIT, None))
        full = run(pool)
        print("=" * 84)
        print(f"H18：EIA 周度原油库存 surprise（季节 z，|z|≥{Z_TH}）→ WTI +{PRIMARY_H} 交易日  [事件研究]")
        print("=" * 84)
        _print_block("IN-SAMPLE <2019", ins)
        print("-" * 84)
        _print_block("HOLDOUT ≥2019", hold)
        print("-" * 84)
        _print_block("FULL ~1986-now", full)
        print("-" * 84)
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_S'] >= MIN_N else 'FAIL'}] ①in-sample 样本≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] ⑤holdout N≥{HOLDOUT_MIN_N} 且净期望>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 84)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
