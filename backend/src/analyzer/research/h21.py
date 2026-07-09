"""H21 回测：宽 universe 资金费 carry（真实结算 + PIT universe + 真实换手成本）。

预注册见 doc/phase3-H21-funding-carry-wide-prereg.md。判据锁死，**不调参**。
H20 三个死因对症：bulk 逐次结算（carry 精确）、147 名含退市（修幸存者偏差 + 功效）、
实测换手边数 × maker 成本。复用 h20 的 assign_legs / week_spread 形状。
跑：`python -m analyzer.research.h21`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from random import Random

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h20 import K_LEG, assign_legs

FUNDING_METRIC = "um_funding_8h"     # fraction/次结算，ts=结算时刻
CLOSE_METRIC = "um_close_1d"         # 日线收盘，ts=收盘
MIN_VALID = 16
MATURITY = timedelta(days=90)        # 成熟度：t 时资金费历史 ≥90d 才可入池
HOLD = timedelta(days=7)
ANCHOR = datetime(2020, 2, 3, tzinfo=timezone.utc)   # bulk 起始月后第一个周一
FRESH = timedelta(days=2)
ENTRY_TOL = timedelta(days=1)
EXIT_TOL = timedelta(days=1.5)
SIDE_COST_MAKER = 0.0003             # 单边 3bps（主判据口径）
SIDE_COST_TAKER = 0.0007             # 单边 7bps（探索并报，不判）
MIN_N = 100
HOLDOUT_MIN_N = 20
SPLIT = datetime(2025, 1, 1, tzinfo=timezone.utc)
NULL_DRAWS = 2000


def _asof_point(points: list[pit.Point], t: datetime) -> pit.Point | None:
    ts = [p[0] for p in points]
    i = bisect_right(ts, t) - 1
    return points[i] if i >= 0 else None


def carry_sum_settlements(funding: list[pit.Point], t0: datetime, t1: datetime) -> float:
    """(t0, t1] 内逐次结算费率（fraction）直接求和——无近似。"""
    return sum(v for ts, v in funding if t0 < ts <= t1)


def sides_traded(prev: tuple[list[str], list[str]] | None,
                 cur: tuple[list[str], list[str]]) -> int:
    """本周交易边数：首周 = 12 边全建仓；此后每换 1 个名 = 2 边（平旧+开新）。"""
    if prev is None:
        return 2 * K_LEG
    n_repl = len(set(cur[0]) - set(prev[0])) + len(set(cur[1]) - set(prev[1]))
    return 2 * n_repl


def spread_gross(per_name: dict[str, tuple[float, float]],
                 longs: list[str], shorts: list[str]) -> float:
    """毛 spread（价差 + carry 现金流，未扣成本）。per_name[sym]=(price_ret, carry_frac)。"""
    long_tot = stats.mean([per_name[s][0] - per_name[s][1] for s in longs])
    short_tot = stats.mean([-per_name[s][0] + per_name[s][1] for s in shorts])
    return long_tot + short_tot


def build_weeks(pool) -> list[dict]:
    """全部再平衡周（PIT 池）：{t, f_by_sym, per_name}。"""
    with pool.connection() as conn:
        syms = [r["symbol"] for r in conn.execute(
            "SELECT DISTINCT symbol FROM metric_samples WHERE metric=%s ORDER BY symbol",
            (FUNDING_METRIC,),
        ).fetchall()]
    funding = {s: pit.load_series(pool, s, FUNDING_METRIC) for s in syms}
    price = {s: pit.load_series(pool, s, CLOSE_METRIC) for s in syms}
    now = datetime.now(timezone.utc)
    weeks = []
    t = ANCHOR
    while t + HOLD + EXIT_TOL <= now:
        f_by_sym: dict[str, float] = {}
        per_name: dict[str, tuple[float, float]] = {}
        for s in syms:
            fs = funding[s]
            if not fs or fs[0][0] > t - MATURITY:      # 成熟度：历史不足 90d 不入池
                continue
            fp = _asof_point(fs, t)
            if fp is None or t - fp[0] > FRESH:         # 新鲜度（退市名到期自然出池）
                continue
            e = pit.value_at_or_after(price[s], t, ENTRY_TOL)
            x = pit.value_at_or_after(price[s], t + HOLD, EXIT_TOL)
            if e is None or x is None or e[1] <= 0:
                continue
            f_by_sym[s] = fp[1]
            per_name[s] = (x[1] / e[1] - 1.0, carry_sum_settlements(fs, t, t + HOLD))
        if len(per_name) >= MIN_VALID:
            weeks.append({"t": t, "f": f_by_sym, "pn": per_name})
        t += timedelta(days=7)
    return weeks


def strategy_series(weeks: list[dict], side_cost: float) -> list[dict]:
    """逐周：毛 spread、成本（按实际换手边数）、净值。顺序敏感（换手依赖上周腿）。"""
    out = []
    prev = None
    for w in weeks:
        legs = assign_legs(w["f"])
        n_sides = sides_traded(prev, legs)
        cost = n_sides * side_cost
        out.append({"t": w["t"], "gross": spread_gross(w["pn"], *legs),
                    "cost": cost, "net": spread_gross(w["pn"], *legs) - cost,
                    "n_pool": len(w["pn"]), "n_sides": n_sides})
        prev = legs
    return out


def _window(rows: list[dict], window: tuple) -> list[dict]:
    since, until = window
    return [r for r in rows
            if not ((since and r["t"] < since) or (until and r["t"] >= until))]


def random_null_upper(weeks: list[dict], strat: list[dict], window: tuple, *,
                      draws: int = NULL_DRAWS, seed: int = 11) -> float:
    """随机分腿零分布：同周同池随机 6+6，成本用**策略当周实际成本**（同担，防放水）。"""
    cost_by_t = {r["t"]: r["cost"] for r in strat}
    sel = [w for w in _window(
        [{"t": w["t"], "w": w} for w in weeks], window)]
    if not sel:
        return float("nan")
    rng = Random(seed)
    means = []
    for _ in range(draws):
        acc = 0.0
        for item in sel:
            w = item["w"]
            names = list(w["pn"])
            rng.shuffle(names)
            acc += spread_gross(w["pn"], names[:K_LEG], names[K_LEG:2 * K_LEG]) \
                - cost_by_t[w["t"]]
        means.append(acc / len(sel))
    means.sort()
    return means[int(0.975 * draws)]


def summarize(weeks: list[dict], strat: list[dict], window: tuple) -> dict:
    rows = _window(strat, window)
    S = [r["net"] for r in rows]
    return {
        "n_S": len(S), "mean": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": random_null_upper(weeks, strat, window),
        "avg_cost": stats.mean([r["cost"] for r in rows]),
        "avg_pool": stats.mean([float(r["n_pool"]) for r in rows]),
        "gross_mean": stats.mean([r["gross"] for r in rows]),
    }


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 有效周 {ins['n_S']} < {MIN_N}"}
    checks = {
        "②周均>0且CI下限>0": ins["mean"] > 0 and ins["ci"][0] > 0,
        "③超随机分腿零分布": ins["mean"] > ins["null_upper"],
        "④周>0占比>50%": ins["hit"] > 0.5,
    }
    ho_ok = hold["n_S"] >= HOLDOUT_MIN_N and hold["mean"] > 0
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
    print(f"  [{tag}] 有效周 {r['n_S']}  周均净={_f(r['mean'])}  CI下限={_f(r['ci'][0])}  "
          f"随机分腿上限={_f(r['null_upper'])}  周>0占比={_f(r['hit'],3)}")
    print(f"      毛={_f(r['gross_mean'])}  周均成本={_f(r['avg_cost'])}  池均={_f(r['avg_pool'],1)} 名")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        weeks = build_weeks(pool)
        strat = strategy_series(weeks, SIDE_COST_MAKER)
        ins = summarize(weeks, strat, (None, SPLIT))
        hold = summarize(weeks, strat, (SPLIT, None))
        full = summarize(weeks, strat, (None, None))
        # 探索（不判）：taker 口径
        strat_tk = strategy_series(weeks, SIDE_COST_TAKER)
        ins_tk = [r["net"] for r in _window(strat_tk, (None, SPLIT))]
        hold_tk = [r["net"] for r in _window(strat_tk, (SPLIT, None))]
        print("=" * 88)
        print(f"H21：宽 universe 资金费 carry（147 名含退市，多最负{K_LEG}/空最正{K_LEG}，7d，"
              f"逐结算 carry，换手边数×maker {SIDE_COST_MAKER*10000:.0f}bps/边）")
        print("=" * 88)
        _print_block("IN-SAMPLE 2020-02~2024", ins)
        print("-" * 88)
        _print_block("HOLDOUT ≥2025", hold)
        print("-" * 88)
        _print_block("FULL", full)
        print("-" * 88)
        print(f"  taker 口径(探索,不判)： in-sample 净={_f(stats.mean(ins_tk))}  "
              f"holdout 净={_f(stats.mean(hold_tk))}")
        print("-" * 88)
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_S'] >= MIN_N else 'FAIL'}] ①in-sample 有效周≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] ⑤holdout ≥{HOLDOUT_MIN_N} 周且周均>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 88)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
