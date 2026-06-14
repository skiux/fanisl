"""H3 回测：爆仓级联 → 短时反转（symmetric fade，做多被爆方向）。

预注册见 doc/phase0-H3-liquidation-reversal-prereg.md。阈值全部来自预注册，**不在此调参**。
复用 Phase 1 harness（pit / stats）。确定性、无 Claude。

跑：`python -m analyzer.research.h3`
"""

from __future__ import annotations

import random
from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats

# ---- 预注册锁定参数 ----
UNIVERSE = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT"]
PCT_WINDOW = timedelta(days=30)
PCT_THRESH = 0.98          # liq_total 的 30d 时间加权分位 ≥ 此（近30天最猛2%小时）
FLOOR = 500_000.0          # 绝对地板（USD），滤安静期假尖峰
DOM = 0.70                 # 单向占优 ≥ 此
DEDUP = timedelta(hours=12)
HORIZONS_H = [4, 8, 12]
PRIMARY_H = 4
BAR_TOL = timedelta(minutes=90)
COST = 0.0014              # 往返 14bps
MIN_N = 40


def _pnl(price: list[pit.Point], signal_ts, d: str, horizon_h: int,
         *, entry_next: bool = True) -> float | None:
    """方向 PnL（净）：做多 d==long 取 +ret，做空取 −ret，扣成本。"""
    if entry_next:
        entry = pit.first_after(price, signal_ts)
    else:
        v = pit.asof(price, signal_ts)
        entry = (signal_ts, v) if v is not None else None
    if entry is None:
        return None
    exit_pt = pit.value_at_or_after(price, entry[0] + timedelta(hours=horizon_h), BAR_TOL)
    if exit_pt is None or entry[1] <= 0:
        return None
    ret = (exit_pt[1] - entry[1]) / entry[1]
    return (ret if d == "long" else -ret) - COST


def run_symbol(pool, symbol: str) -> dict:
    lt = pit.load_series(pool, symbol, "liq_total_1h")
    ll = dict(pit.load_series(pool, symbol, "liq_long_1h"))
    ls = dict(pit.load_series(pool, symbol, "liq_short_1h"))
    price = pit.load_series(pool, symbol, "price")
    atr = pit.load_series(pool, symbol, "atr_pct_1h")
    if not lt or not price:
        return {"symbol": symbol, "skipped": True}

    # 触发：地板 → 分位 → 单向占优；方向 = 被爆占优方（fade）
    cand: list[tuple] = []
    for ts, tot in lt:
        if tot < FLOOR:
            continue
        p = pit.tw_percentile_at(lt, ts, PCT_WINDOW)
        if p is None or p < PCT_THRESH:
            continue
        lo, sh = ll.get(ts, 0.0), ls.get(ts, 0.0)
        if tot <= 0 or max(lo, sh) / tot < DOM:
            continue
        cand.append((ts, "long" if lo > sh else "short"))
    cand.sort(key=lambda x: x[0])
    triggers: list[tuple] = []
    for ts, d in cand:
        if not triggers or ts - triggers[-1][0] >= DEDUP:
            triggers.append((ts, d))

    s_pnl = {h: [] for h in HORIZONS_H}
    s_radj = []
    n_long = n_short = 0
    for ts, d in triggers:
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

    # 无条件方向 PnL 池（主 horizon，进场=该价格点）：随机择时零分布用
    pool_long, pool_short = [], []
    for tp, _ in price:
        vl = _pnl(price, tp, "long", PRIMARY_H, entry_next=False)
        vs = _pnl(price, tp, "short", PRIMARY_H, entry_next=False)
        if vl is not None:
            pool_long.append(vl)
        if vs is not None:
            pool_short.append(vs)

    return {
        "symbol": symbol, "n_triggers": len(triggers), "n_long": n_long, "n_short": n_short,
        "s_pnl": s_pnl, "s_radj": s_radj, "pool_long": pool_long, "pool_short": pool_short,
    }


def _mixed_null_upper(pool_long, pool_short, n_long, n_short, *, n=10000, seed=2) -> float:
    """随机择时零分布：保留 S 的多空配比，但随机择时，bootstrap 均值的 97.5 分位。"""
    if n_long + n_short == 0 or (n_long and not pool_long) or (n_short and not pool_short):
        return float("nan")
    rng = random.Random(seed)
    tot = n_long + n_short
    means = []
    for _ in range(n):
        s = sum(rng.choice(pool_long) for _ in range(n_long)) if n_long else 0.0
        s += sum(rng.choice(pool_short) for _ in range(n_short)) if n_short else 0.0
        means.append(s / tot)
    means.sort()
    return means[int(0.975 * n)]


def run(pool) -> dict:
    per = [run_symbol(pool, s) for s in UNIVERSE]
    per = [r for r in per if not r.get("skipped")]
    S = [x for r in per for x in r["s_pnl"][PRIMARY_H]]
    S_radj = [x for r in per for x in r["s_radj"]]
    n_long = sum(r["n_long"] for r in per)
    n_short = sum(r["n_short"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    n = len(S)
    p = {
        "n_S": n, "n_long": n_long, "n_short": n_short,
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
        label = "无 edge（级联后疑似继续同向/知情流）→ 杀掉 H3，记反向线索"
    else:
        label = "无 edge → 杀掉 H3"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def print_report(res: dict) -> None:
    print("=" * 80)
    print("H3 回测：爆仓级联 → 4h 反转（fade 被爆方向）  [预注册 doc/phase0-H3-...]")
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
