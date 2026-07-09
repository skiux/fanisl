"""H20 回测：横截面资金费 carry（crypto 永续，市场中性，含资金费现金流）。

预注册见 doc/phase3-H20-funding-carry-prereg.md。判据锁死，**不调参**。
H17 四格对照线索的正式检验：多最负费率 6 名 / 空最正 6 名，周度再平衡，
收益 = 价差 + 两腿资金费净收入 − 28bps/周。复用 pit/stats。确定性、无 Claude。
跑：`python -m analyzer.research.h20`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from random import Random

from ..config import get_settings
from ..db import make_pool
from . import pit, stats

FUNDING_METRIC = "funding_rate_1d"   # percent/8h（当日 close 结算），ts=桶收盘
K_LEG = 6                            # 每腿名数（锁定）
MIN_VALID = 16                       # 当周有效标的下限，不足跳周
HOLD = timedelta(days=7)
ANCHOR = datetime(2021, 7, 19, tzinfo=timezone.utc)   # 数据起点后第一个周一
FRESH = timedelta(days=2)            # 资金费新鲜度
ENTRY_TOL = timedelta(days=1)
EXIT_TOL = timedelta(days=1.5)
SETTLES_PER_DAY = 3                  # 日累计 ≈ close 费率 × 3（近似，见预注册）
COST_SPREAD = 0.0028                 # 每腿全换手 14bps 往返 × 2 腿
MIN_N = 100
HOLDOUT_MIN_N = 20
SPLIT = datetime(2025, 1, 1, tzinfo=timezone.utc)
NULL_DRAWS = 2000


def _asof_point(points: list[pit.Point], t: datetime) -> pit.Point | None:
    ts = [p[0] for p in points]
    i = bisect_right(ts, t) - 1
    return points[i] if i >= 0 else None


def carry_sum(funding: list[pit.Point], t0: datetime, t1: datetime) -> float:
    """(t0, t1] 内资金费累计（fraction）：Σ 当日 close 费率% × 3 次结算 / 100。"""
    return sum(v * SETTLES_PER_DAY / 100.0 for ts, v in funding if t0 < ts <= t1)


def assign_legs(f_by_sym: dict[str, float], k: int = K_LEG) -> tuple[list[str], list[str]]:
    """按费率升序：最负 k 名 long，最正 k 名 short。"""
    order = sorted(f_by_sym, key=lambda s: f_by_sym[s])
    return order[:k], order[-k:]


def week_spread(per_name: dict[str, tuple[float, float]],
                longs: list[str], shorts: list[str]) -> float:
    """周 spread 净收益（2 单位名义）。per_name[sym] = (price_ret, carry_frac)，
    carry_frac = Σ 3·f/100。long 腿收 −carry（费率负→收钱），short 腿收 +carry。"""
    long_tot = stats.mean([per_name[s][0] - per_name[s][1] for s in longs])
    short_tot = stats.mean([-per_name[s][0] + per_name[s][1] for s in shorts])
    return long_tot + short_tot - COST_SPREAD


def _universe(pool) -> list[str]:
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT DISTINCT symbol FROM metric_samples WHERE metric=%s ORDER BY symbol",
            (FUNDING_METRIC,),
        ).fetchall()
    return [r["symbol"] for r in rows]


def build_weeks(pool) -> list[dict]:
    """全部再平衡周：{t, f_by_sym, per_name}。per_name 只含三要素齐备的标的。"""
    syms = _universe(pool)
    funding = {s: pit.load_series(pool, s, FUNDING_METRIC) for s in syms}
    price = {s: pit.load_series(pool, s, "price") for s in syms}
    now = datetime.now(timezone.utc)
    weeks = []
    t = ANCHOR
    while t + HOLD + EXIT_TOL <= now:
        f_by_sym: dict[str, float] = {}
        per_name: dict[str, tuple[float, float]] = {}
        for s in syms:
            fp = _asof_point(funding[s], t)
            if fp is None or t - fp[0] > FRESH:
                continue
            e = pit.value_at_or_after(price[s], t, ENTRY_TOL)
            x = pit.value_at_or_after(price[s], t + HOLD, EXIT_TOL)
            if e is None or x is None or e[1] <= 0:
                continue
            f_by_sym[s] = fp[1]
            per_name[s] = (x[1] / e[1] - 1.0, carry_sum(funding[s], t, t + HOLD))
        if len(per_name) >= MIN_VALID:
            weeks.append({"t": t, "f": f_by_sym, "pn": per_name})
        t += timedelta(days=7)
    return weeks


def spreads_for(weeks: list[dict], window: tuple = (None, None)) -> list[float]:
    since, until = window
    out = []
    for w in weeks:
        if (since and w["t"] < since) or (until and w["t"] >= until):
            continue
        longs, shorts = assign_legs(w["f"])
        out.append(week_spread(w["pn"], longs, shorts))
    return out


def decompose(weeks: list[dict], window: tuple = (None, None)) -> dict:
    """探索性分解（不参与裁决）：spread = 价差部分 + carry 现金流部分 − 成本。"""
    since, until = window
    price_parts, carry_parts = [], []
    for w in weeks:
        if (since and w["t"] < since) or (until and w["t"] >= until):
            continue
        longs, shorts = assign_legs(w["f"])
        pn = w["pn"]
        price_parts.append(stats.mean([pn[s][0] for s in longs])
                           - stats.mean([pn[s][0] for s in shorts]))
        carry_parts.append(stats.mean([pn[s][1] for s in shorts])
                           - stats.mean([pn[s][1] for s in longs]))
    return {"price_part": stats.mean(price_parts), "carry_part": stats.mean(carry_parts)}


def random_null_upper(weeks: list[dict], window: tuple, *, draws: int = NULL_DRAWS,
                      seed: int = 7) -> float:
    """随机分腿零分布：同一批周、同周有效标的里随机 6+6 不重叠，含 carry 与成本。"""
    since, until = window
    sel = [w for w in weeks
           if not ((since and w["t"] < since) or (until and w["t"] >= until))]
    if not sel:
        return float("nan")
    rng = Random(seed)
    means = []
    for _ in range(draws):
        acc = 0.0
        for w in sel:
            names = list(w["pn"])
            rng.shuffle(names)
            acc += week_spread(w["pn"], names[:K_LEG], names[K_LEG:2 * K_LEG])
        means.append(acc / len(sel))
    means.sort()
    return means[int(0.975 * draws)]


def summarize(weeks: list[dict], window: tuple) -> dict:
    S = spreads_for(weeks, window)
    return {
        "n_S": len(S), "mean": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": random_null_upper(weeks, window),
        **decompose(weeks, window),
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
    print(f"  [{tag}] 有效周 {r['n_S']}  周均={_f(r['mean'])}  CI下限={_f(r['ci'][0])}  "
          f"随机分腿上限={_f(r['null_upper'])}  周>0占比={_f(r['hit'],3)}")
    print(f"      分解(探索)： 价差={_f(r['price_part'])}  carry现金流={_f(r['carry_part'])}  "
          f"成本=-{COST_SPREAD:.4f}")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        weeks = build_weeks(pool)
        ins = summarize(weeks, (None, SPLIT))
        hold = summarize(weeks, (SPLIT, None))
        full = summarize(weeks, (None, None))
        print("=" * 84)
        print(f"H20：横截面资金费 carry（多最负{K_LEG}/空最正{K_LEG}，持有 7d，含资金费现金流，"
              f"扣 {COST_SPREAD*10000:.0f}bps/周）")
        print("=" * 84)
        _print_block("IN-SAMPLE 2021-07~2024", ins)
        print("-" * 84)
        _print_block("HOLDOUT ≥2025", hold)
        print("-" * 84)
        _print_block("FULL", full)
        print("-" * 84)
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_S'] >= MIN_N else 'FAIL'}] ①in-sample 有效周≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] ⑤holdout ≥{HOLDOUT_MIN_N} 周且周均>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 84)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
