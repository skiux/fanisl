"""H5 回测：突破延续（time-series 动量）。

预注册见 doc/phase0-H5-breakout-momentum-prereg.md。阈值全部来自预注册，**不在此调参**。
第一次测反转家族的对立面（H1/H3/H4 全 KILLED）。只用 price，零新数据。PnL/零分布复用 H3。
确定性、无 Claude。跑：`python -m analyzer.research.h5`
"""

from __future__ import annotations

from bisect import bisect_left
from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import COST, MIN_N, _mixed_null_upper, _pnl

# ---- 预注册锁定 ----
UNIVERSE = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT"]
BREAK_W = timedelta(hours=48)      # 突破窗
MIN_BARS = 24                      # prior 窗内最少 bar 数
MIN_SPAN = BREAK_W * 0.8           # prior 回看最短跨度
DEDUP = timedelta(hours=24)        # = 持有期，样本不重叠
HORIZONS_H = [12, 24, 48]
PRIMARY_H = 24


def _breakouts(price: list[pit.Point]) -> list[tuple]:
    """突破触发：price(t) 严格超过前 W 窗内的 max/min（point-in-time，无未来函数）。

    返回去重叠后的 [(ts, "long"|"short")]。prior = [t−W, t) 严格在 t 之前的子序列。
    """
    ts = [p[0] for p in price]
    cand = []
    for i, (t, v) in enumerate(price):
        j = bisect_left(ts, t - BREAK_W)        # prior 起点
        prior = price[j:i]                      # 严格 <t
        if len(prior) < MIN_BARS or (t - prior[0][0]) < MIN_SPAN:
            continue
        hi = max(p[1] for p in prior)
        lo = min(p[1] for p in prior)
        if v > hi:
            cand.append((t, "long"))
        elif v < lo:
            cand.append((t, "short"))
    # 去重叠
    out = []
    for t, d in cand:
        if not out or t - out[-1][0] >= DEDUP:
            out.append((t, d))
    return out


def run_symbol(pool, symbol: str) -> dict:
    price = pit.load_series(pool, symbol, "price")
    atr = pit.load_series(pool, symbol, "atr_pct_1h")
    if not price:
        return {"symbol": symbol, "skipped": True}

    trig = _breakouts(price)
    s_pnl = {h: [] for h in HORIZONS_H}
    s_radj = []
    n_long = n_short = 0
    for ts, d in trig:
        n_long += d == "long"
        n_short += d == "short"
        a = pit.asof(atr, ts)
        for h in HORIZONS_H:
            v = _pnl(price, ts, d, h)
            if v is None:
                continue
            s_pnl[h].append(v)
            if h == PRIMARY_H and a:
                s_radj.append(v / a)

    pool_long, pool_short = [], []
    for tp, _ in price:
        vl = _pnl(price, tp, "long", PRIMARY_H, entry_next=False)
        vs = _pnl(price, tp, "short", PRIMARY_H, entry_next=False)
        if vl is not None:
            pool_long.append(vl)
        if vs is not None:
            pool_short.append(vs)

    return {
        "symbol": symbol, "n_triggers": len(trig), "n_long": n_long, "n_short": n_short,
        "s_pnl": s_pnl, "s_radj": s_radj, "pool_long": pool_long, "pool_short": pool_short,
    }


def run(pool) -> dict:
    per = [run_symbol(pool, s) for s in UNIVERSE]
    per = [r for r in per if not r.get("skipped")]
    S = [x for r in per for x in r["s_pnl"][PRIMARY_H]]
    S_radj = [x for r in per for x in r["s_radj"]]
    n_long = sum(r["n_long"] for r in per)
    n_short = sum(r["n_short"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    p = {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "uncond_mean": stats.mean(pool_long + pool_short),
        "mean_radj": stats.mean(S_radj),
        "symbols_positive": sum(1 for r in per if r["s_pnl"][PRIMARY_H]
                                and stats.mean(r["s_pnl"][PRIMARY_H]) > 0),
        "symbols_total": len(per),
    }
    p["verdict"] = _verdict(p)
    return {"per_symbol": per, "pooled": p}


def _verdict(p: dict) -> dict:
    if p["n_S"] < MIN_N:
        return {"label": "功效不足/暂不可测", "reason": f"样本 {p['n_S']} < {MIN_N}，去前向积累"}
    c2 = p["mean_pnl"] > 0 and p["ci"][0] > 0
    c3 = p["mean_pnl"] > p["null_upper"]
    c4 = p["hit"] > 0.5
    c5 = p["symbols_positive"] >= 3
    checks = {"②净期望>0且CI下限>0": c2, "③超随机择时零分布": c3,
              "④命中>50%": c4, "⑤≥3标的正": c5}
    if all(checks.values()):
        label = "有戏（promising）→ Phase 4 前向确认"
    elif p["mean_pnl"] < 0:
        label = "无 edge（突破后回落/假突破主导）→ 杀掉 H5"
    else:
        label = "无 edge → 杀掉 H5"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def print_report(res: dict) -> None:
    print("=" * 80)
    print("H5 回测：突破延续（48h 新高/低 → +24h 动量）  [预注册 doc/phase0-H5-...]")
    print("=" * 80)
    print(f"{'标的':<10}{'触发':>6}{'多/空':>9}{'净PnL均值':>12}{'命中':>8}")
    for r in res["per_symbol"]:
        sp = r["s_pnl"][PRIMARY_H]
        ls = f"{r['n_long']}/{r['n_short']}"
        print(f"{r['symbol']:<10}{r['n_triggers']:>6}{ls:>9}"
              f"{_f(stats.mean(sp)):>12}{_f(stats.hit_rate(sp), 2):>8}")
    p = res["pooled"]
    print("-" * 80)
    print(f"合并(主 horizon +{PRIMARY_H}h)：触发 {p['n_S']}（多 {p['n_long']} / 空 {p['n_short']}）")
    print(f"  净 PnL 均值 S={_f(p['mean_pnl'])}（扣 {COST*1e4:.0f}bps）  S的95%单边CI下限={_f(p['ci'][0])}")
    print(f"  随机择时零分布上限={_f(p['null_upper'])}  无条件方向均值={_f(p['uncond_mean'])}")
    print(f"  命中率={_f(p['hit'], 3)}  风险调整均值={_f(p['mean_radj'])}  标的同向正 {p['symbols_positive']}/{p['symbols_total']}")
    print("-" * 80)
    v = p["verdict"]
    if "checks" in v:
        print(f"  [{'PASS' if p['n_S'] >= MIN_N else 'FAIL'}] ①样本 ≥ {MIN_N}")
        for k, ok in v["checks"].items():
            print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
    print(f"\n  裁决：{v['label']}")
    if "reason" in v:
        print(f"        {v['reason']}")
    print("=" * 80)


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        print_report(run(pool))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
