"""H17 回测:趋势×定位闸门——上升趋势(价>SMA200)中的负资金费 → 逼空/carry 做多,+3 日。

预注册见 doc/phase3-H17-trend-gated-positioning-prereg.md。阈值锁死,**不调参**。
与已死 H1 的区别:条件化(趋势闸门)、顺势 carry 机制(非均值回归)、+3d horizon、5 年资金费×23 标的带 holdout。
判据③用**趋势内随机择时零分布**(同样 up 的日 bar 抽样),直接检验资金费的增量、排除趋势 beta 假阳。
确定性、无 Claude。跑:`python -m analyzer.research.h17`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats

UNIVERSE = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT",
    "AVAX/USDT", "LINK/USDT", "NEAR/USDT", "ATOM/USDT", "FIL/USDT", "APT/USDT",
    "ARB/USDT", "OP/USDT", "INJ/USDT", "SUI/USDT", "SEI/USDT", "TIA/USDT",
    "RUNE/USDT", "AAVE/USDT", "LDO/USDT", "DOGE/USDT", "DOT/USDT", "LTC/USDT",
]
SMA_N = 200
SMA_MIN = 150            # SMA 至少要有的日收盘数,不足跳过(历史不够不出信号)
HORIZONS_B = [1, 3, 7]   # 持有(日 bar 数)
PRIMARY_B = 3
DEDUP_DAYS = 3           # = 主持有
COST = 0.0014
MIN_N = 40
SPLIT = datetime(2025, 1, 1, tzinfo=timezone.utc)
CELLS = ("A", "B", "C", "D")   # A=up∧neg(主格,做多) B=down∧neg C=up∧pos D=down∧pos


def _daily_closes(series: list[pit.Point]) -> list[pit.Point]:
    """重采样为逐日最后收盘(每个日历日取最晚时间戳的点)。"""
    by_day: dict = {}
    for t, v in series:
        d = t.date()
        cur = by_day.get(d)
        if cur is None or t > cur[0]:
            by_day[d] = (t, v)
    return [by_day[d] for d in sorted(by_day)]


def _sma_pit(closes: list[float], j: int) -> float | None:
    """截至下标 j(含)的 SMA200;可用日收盘 <SMA_MIN 个则 None。"""
    lo = max(0, j - SMA_N + 1)
    win = closes[lo: j + 1]
    if len(win) < SMA_MIN:
        return None
    return sum(win) / len(win)


def _long_pnl(closes: list[float], entry_i: int, bars: int) -> float | None:
    xi = entry_i + bars
    if entry_i >= len(closes) or xi >= len(closes) or closes[entry_i] <= 0:
        return None
    return closes[xi] / closes[entry_i] - 1.0 - COST


def run_symbol(pool, symbol: str, window: tuple | None = None) -> dict:
    daily = _daily_closes(pit.load_series(pool, symbol, "price"))
    fund = pit.load_series(pool, symbol, "funding_rate_1d")
    if len(daily) < SMA_MIN or not fund:
        return {"symbol": symbol, "skipped": True}
    since, until = window or (None, None)
    dts = [t for t, _ in daily]
    closes = [v for _, v in daily]

    cells = {c: {b: [] for b in HORIZONS_B} for c in CELLS}
    n_trig = {c: 0 for c in CELLS}
    last = None
    for t, f in fund:
        if (since and t < since) or (until and t >= until):
            continue
        j = bisect_right(dts, t) - 1            # 最后一个 ≤t 的日收盘
        if j < 0:
            continue
        sma = _sma_pit(closes, j)
        if sma is None or f == 0:
            continue
        if last is not None and (t - last).days < DEDUP_DAYS:
            continue
        up = closes[j] > sma
        cell = ("A" if f < 0 else "C") if up else ("B" if f < 0 else "D")
        entry_i = j + 1                          # t 之后第一个日收盘
        got = False
        for b in HORIZONS_B:
            v = _long_pnl(closes, entry_i, b)
            if v is not None:
                cells[cell][b].append(v)
                got = True
        if got:
            n_trig[cell] += 1
            last = t

    # 趋势内随机择时零分布池:同样 up 的每个日 bar,镜像交易时序(信号=收盘 i,进 i+1,出 i+1+PRIMARY)
    null_pool = []
    for i in range(len(daily)):
        if (since and dts[i] < since) or (until and dts[i] >= until):
            continue
        sma = _sma_pit(closes, i)
        if sma is None or closes[i] <= sma:
            continue
        v = _long_pnl(closes, i + 1, PRIMARY_B)
        if v is not None:
            null_pool.append(v)

    return {"symbol": symbol, "cells": cells, "n_trig": n_trig, "null_pool": null_pool}


def run(pool, window: tuple | None = None) -> dict:
    per = [run_symbol(pool, s, window) for s in UNIVERSE]
    per = [r for r in per if not r.get("skipped")]
    A = [x for r in per for x in r["cells"]["A"][PRIMARY_B]]
    null_pool = [x for r in per for x in r["null_pool"]]
    # ⑤:触发 ≥3 次的标的里 mean>0 的占比
    active = [(r["symbol"], stats.mean(r["cells"]["A"][PRIMARY_B]))
              for r in per if len(r["cells"]["A"][PRIMARY_B]) >= 3]
    p = {
        "n_A": len(A), "mean": stats.mean(A), "hit": stats.hit_rate(A),
        "ci": stats.bootstrap_ci(A, lo=5.0, hi=95.0) if A else (float("nan"),) * 2,
        "null_upper": stats.random_null_upper(null_pool, len(A)) if A and null_pool else float("nan"),
        "null_mean": stats.mean(null_pool),
        "sym_pos": sum(1 for _, m in active if m > 0), "sym_active": len(active),
        "cell_means": {c: stats.mean([x for r in per for x in r["cells"][c][PRIMARY_B]]) for c in CELLS},
        "cell_ns": {c: sum(len(r["cells"][c][PRIMARY_B]) for r in per) for c in CELLS},
        "alt_h": {b: stats.mean([x for r in per for x in r["cells"]["A"][b]]) for b in HORIZONS_B},
        "per": per,
    }
    return p


def _verdict(ins: dict, hold: dict) -> dict:
    if ins["n_A"] < MIN_N:
        return {"label": "功效不足", "reason": f"in-sample A 样本 {ins['n_A']} < {MIN_N}"}
    frac_ok = ins["sym_active"] > 0 and ins["sym_pos"] >= 0.6 * ins["sym_active"]
    checks = {
        "②净期望>0且CI下限>0": ins["mean"] > 0 and ins["ci"][0] > 0,
        "③超趋势内随机择时零分布": ins["mean"] > ins["null_upper"],
        "④命中>50%": ins["hit"] > 0.5,
        "⑤≥60%活跃标的正": frac_ok,
        "⑥holdout N≥20 且 mean>0": hold["n_A"] >= 20 and hold["mean"] > 0,
    }
    if all(checks.values()):
        label = "有戏(趋势×定位条件化成立、超趋势基线、跨 regime)→ Phase 4 前向 ★"
    elif ins["mean"] <= 0:
        label = "无 edge(上升趋势中负资金费做多亦不为正)→ KILLED"
    elif not checks["③超趋势内随机择时零分布"]:
        label = "无增量(与趋势内随机择时无差 → 资金费不带额外信息)→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _block(tag: str, p: dict) -> None:
    print(f"  [{tag}] A(up∧neg)触发 {p['n_A']}  净={_f(p['mean'])}  CI下限={_f(p['ci'][0])}  "
          f"趋势内零分布上限={_f(p['null_upper'])}(池均值 {_f(p['null_mean'])})  "
          f"命中={_f(p['hit'], 3)}  标的正 {p['sym_pos']}/{p['sym_active']}")
    cm, cn = p["cell_means"], p["cell_ns"]
    print(f"      对照(探索): B(down∧neg)={_f(cm['B'])}(n={cn['B']})  "
          f"C(up∧pos)={_f(cm['C'])}(n={cn['C']})  D(down∧pos)={_f(cm['D'])}(n={cn['D']})")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins = run(pool, (None, SPLIT))
        hold = run(pool, (SPLIT, None))
        print("=" * 88)
        print(f"H17:趋势×定位闸门——up(价>SMA200)∧负资金费 → 做多 +{PRIMARY_B}日  [23 永续,5y funding]")
        print("=" * 88)
        _block("IN-SAMPLE <2025", ins)
        print("-" * 88)
        _block("HOLDOUT ≥2025", hold)
        print("-" * 88)
        ah = ins["alt_h"]
        print("  A 各持有(in-sample,探索): " + "  ".join(f"{b}d={_f(ah[b])}" for b in HORIZONS_B))
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_A'] >= MIN_N else 'FAIL'}] ①in-sample A ≥ {MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"\n  裁决:{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 88)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
