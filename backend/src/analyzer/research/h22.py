"""H22 回测：EIA 发布过冲的盘中回归（fade surprise，M1 粒度）。

预注册见 doc/phase3-H22-eia-overshoot-fade-prereg.md（含线索来源披露：假设形成于
H19 之后，PASS 也只算强候选、须过纸面前向）。判据锁死，**不调参**。
surprise/假期规则逐字复用 h18/h19，仅改方向（fade）与执行粒度（M1，+5min 进场）。
跑：`python -m analyzer.research.h22`
"""

from __future__ import annotations

from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from random import Random

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h18 import Z_TH, build_events, seasonal_z
from .h19 import adjusted_publish

SYMBOL = "CL"
PRICE_METRIC = "price_1m"          # 稀疏事件窗 M1（ts=收盘）
ENTRY_DELAY = timedelta(minutes=5)
ENTRY_MAX_LAG = timedelta(minutes=15)   # 进场 bar 距“发布+5min”超此 → 数据洞，丢弃
HOLD_HOURS = {2: "探索", 6: "主", 24: "探索"}
PRIMARY_H = 6
EXIT_TOL = timedelta(minutes=30)
COST = 0.0012                      # 往返 12bps（发布后点差保守加成）
COST_ALT = 0.0020                  # 敏感性并报（不判）
MIN_N = 100
HOLDOUT_MIN_N = 20
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)


def fade_ret(price: list[pit.Point], adj_pub: datetime, hold_h: float) -> float | None:
    """fade 方向的毛收益（多头向）：进场=发布+5min 后第一根 M1 收盘，出场=进场+hold_h。
    返回**多头方向**毛收益；方向符号由调用方按 z 叠加。"""
    ts = [p[0] for p in price]
    t_entry = adj_pub + ENTRY_DELAY
    i = bisect_left(ts, t_entry)
    if i >= len(price):
        return None
    if price[i][0] - t_entry > ENTRY_MAX_LAG:
        return None
    entry = price[i]
    exit_ = pit.value_at_or_after(price, entry[0] + timedelta(hours=hold_h), EXIT_TOL)
    if exit_ is None or entry[1] <= 0:
        return None
    return exit_[1] / entry[1] - 1.0


def _sign_null_upper(base_rets: list[float], size: int, cost: float, *,
                     n: int = 10000, seed: int = 5) -> float:
    if not base_rets or size <= 0:
        return float("nan")
    rng = Random(seed)
    means = sorted(
        sum(rng.choice((1.0, -1.0)) * rng.choice(base_rets) - cost for _ in range(size)) / size
        for _ in range(n)
    )
    return means[int(0.975 * n)]


def run(pool, window: tuple = (None, None)) -> dict:
    inv = pit.load_series(pool, SYMBOL, "eia_crude_stocks")
    price = pit.load_series(pool, SYMBOL, PRICE_METRIC)
    events = build_events(inv)
    since, until = window

    s_pnl: dict[int, list[float]] = {h: [] for h in HOLD_HOURS}
    s_pnl_alt_cost: list[float] = []
    base_rets: list[float] = []
    n_long = n_short = 0
    for i, (ts, _p, _d) in enumerate(events):
        adj = adjusted_publish(ts)
        if (since and adj < since) or (until and adj >= until):
            continue
        base = fade_ret(price, adj, PRIMARY_H)
        if base is None:
            continue
        base_rets.append(base)
        z = seasonal_z(events, i)
        if z is None or abs(z) < Z_TH:
            continue
        # fade：超预期累库(z>0, bearish 过冲下跌) → long；反之 short
        sign = 1.0 if z > 0 else -1.0
        n_long += sign > 0
        n_short += sign < 0
        for h in HOLD_HOURS:
            r = fade_ret(price, adj, h)
            if r is not None:
                s_pnl[h].append(sign * r - COST)
        s_pnl_alt_cost.append(sign * base - COST_ALT)

    S = s_pnl[PRIMARY_H]
    return {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _sign_null_upper(base_rets, len(S), COST),
        "alt_h": {h: stats.mean(s_pnl[h]) for h in HOLD_HOURS},
        "alt_n": {h: len(s_pnl[h]) for h in HOLD_HOURS},
        "alt_cost_mean": stats.mean(s_pnl_alt_cost),
        "n_events_priced": len(base_rets),
    }


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample 样本 {ins['n_S']} < {MIN_N}"}
    checks = {
        "②净期望>0且CI下限>0": ins["mean_pnl"] > 0 and ins["ci"][0] > 0,
        "③超随机符号零分布": ins["mean_pnl"] > ins["null_upper"],
        "④命中>50%": ins["hit"] > 0.5,
    }
    ho_ok = hold["n_S"] >= HOLDOUT_MIN_N and hold["mean_pnl"] > 0
    if all(checks.values()) and ho_ok:
        label = "强候选（非 edge：线索源自 H19，须过纸面前向）→ playbook candidate"
    elif all(checks.values()):
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（不得挪判据）"
    else:
        label = "无 edge → KILLED（EIA 链 H18/H19/H22 收档）"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _print_block(tag: str, r: dict) -> None:
    print(f"  [{tag}] 触发 {r['n_S']}（多 {r['n_long']}/空 {r['n_short']}；有价事件 {r['n_events_priced']}）  "
          f"净={_f(r['mean_pnl'])}  CI下限={_f(r['ci'][0])}  符号零分布上限={_f(r['null_upper'])}  "
          f"命中={_f(r['hit'],3)}")
    print("      各持有(探索)： " + "  ".join(
        f"+{h}h={_f(r['alt_h'][h])}(n={r['alt_n'][h]})" for h in HOLD_HOURS))
    print(f"      20bps 成本口径(探索,不判)： 净={_f(r['alt_cost_mean'])}")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins = run(pool, (None, SPLIT))
        hold = run(pool, (SPLIT, None))
        full = run(pool)
        print("=" * 88)
        print(f"H22：EIA 过冲回归（fade surprise，|z|≥{Z_TH}，发布+5min 进场，M1）→ +{PRIMARY_H}h  扣 12bps")
        print("=" * 88)
        _print_block("IN-SAMPLE 2008-2018", ins)
        print("-" * 88)
        _print_block("HOLDOUT ≥2019", hold)
        print("-" * 88)
        _print_block("FULL 2008-now", full)
        print("-" * 88)
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_S'] >= MIN_N else 'FAIL'}] ①in-sample 样本≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] ⑤holdout N≥{HOLDOUT_MIN_N} 且净期望>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 88)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
