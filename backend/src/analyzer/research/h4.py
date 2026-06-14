"""H4 回测：爆仓级联 × OI 去杠杆 → 条件化反转（fade）。

预注册见 doc/phase0-H4-cascade-oi-conditional-prereg.md。阈值全部来自预注册，**不在此调参**。
触发与 PnL 复用 H3（级联定义不变），新增 OI 条件把触发集一分为二：
  - DELEV（去杠杆，oi_chg<0）= 主裁决子集，假设 fade 成立；
  - RELEV（加仓，oi_chg>0）= 对照（探索，假设继续同向），不进主裁决。
确定性、无 Claude。跑：`python -m analyzer.research.h4`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import (
    BAR_TOL, COST, DEDUP, DOM, FLOOR, MIN_N, PCT_THRESH, PCT_WINDOW,
    PRIMARY_H, UNIVERSE, _mixed_null_upper, _pnl,
)

# ---- 预注册锁定（H4 新增）----
OI_LOOKBACK = timedelta(hours=3)   # ΔOI 的回看窗
OI_TOL = timedelta(minutes=90)     # OI 取值容差（超出视为缺值，剔除该触发）
HORIZONS_H = [4, 8, 12]


def _asof_fresh(points: list[pit.Point], t, tol) -> float | None:
    """t 当时已知的值（ts ≤ t 的最后一点），且该点距 t 不超过 tol（否则视为陈旧/缺值）。无未来函数。"""
    ts = [p[0] for p in points]
    i = bisect_right(ts, t) - 1
    if i < 0 or (t - points[i][0]) > tol:
        return None
    return points[i][1]


def _oi_chg(oi: list[pit.Point], t) -> float | None:
    """oi_chg(t)=(OI@t − OI@(t−3h))/OI@(t−3h)，严格只用 ≤t 的 OI。任一端缺/陈旧或基准≤0 → None。"""
    now = _asof_fresh(oi, t, OI_TOL)
    base = _asof_fresh(oi, t - OI_LOOKBACK, OI_TOL)
    if now is None or base is None or base <= 0:
        return None
    return (now - base) / base


def _triggers(pool, symbol: str):
    """复用 H3 级联触发：返回去重叠后的 [(ts, side)]。"""
    lt = pit.load_series(pool, symbol, "liq_total_1h")
    ll = dict(pit.load_series(pool, symbol, "liq_long_1h"))
    ls = dict(pit.load_series(pool, symbol, "liq_short_1h"))
    if not lt:
        return [], None, None, None
    cand = []
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
    trig = []
    for ts, d in cand:
        if not trig or ts - trig[-1][0] >= DEDUP:
            trig.append((ts, d))
    return trig, lt, ll, ls


def run_symbol(pool, symbol: str) -> dict:
    trig, lt, _, _ = _triggers(pool, symbol)
    price = pit.load_series(pool, symbol, "price")
    atr = pit.load_series(pool, symbol, "atr_pct_1h")
    oi = pit.load_series(pool, symbol, "oi_usd_1h")
    if lt is None or not price or not oi:
        return {"symbol": symbol, "skipped": True}

    # 按 OI 去杠杆条件分流
    subs = {"DELEV": {"pnl": {h: [] for h in HORIZONS_H}, "radj": [], "nl": 0, "ns": 0},
            "RELEV": {"pnl": {h: [] for h in HORIZONS_H}, "radj": [], "nl": 0, "ns": 0}}
    n_drop = n_oimiss = 0
    for ts, d in trig:
        chg = _oi_chg(oi, ts)
        if chg is None:
            n_oimiss += 1
            continue
        if chg == 0:
            continue
        bucket = "DELEV" if chg < 0 else "RELEV"
        sub = subs[bucket]
        sub["nl" if d == "long" else "ns"] += 1
        a = pit.asof(atr, ts)
        for h in HORIZONS_H:
            v = _pnl(price, ts, d, h)
            if v is None:
                continue
            sub["pnl"][h].append(v)
            if h == PRIMARY_H and a:
                sub["radj"].append(v / a)

    # 无条件方向 PnL 池（随机择时零分布用，与 H3 同）
    pool_long, pool_short = [], []
    for tp, _ in price:
        vl = _pnl(price, tp, "long", PRIMARY_H, entry_next=False)
        vs = _pnl(price, tp, "short", PRIMARY_H, entry_next=False)
        if vl is not None:
            pool_long.append(vl)
        if vs is not None:
            pool_short.append(vs)

    return {
        "symbol": symbol, "n_trig": len(trig), "n_oimiss": n_oimiss,
        "subs": subs, "pool_long": pool_long, "pool_short": pool_short,
    }


def _pool_sub(per: list[dict], bucket: str) -> dict:
    S = [x for r in per for x in r["subs"][bucket]["pnl"][PRIMARY_H]]
    radj = [x for r in per for x in r["subs"][bucket]["radj"]]
    n_long = sum(r["subs"][bucket]["nl"] for r in per)
    n_short = sum(r["subs"][bucket]["ns"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    return {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "mean_radj": stats.mean(radj),
        "symbols_positive": sum(1 for r in per if r["subs"][bucket]["pnl"][PRIMARY_H]
                                and stats.mean(r["subs"][bucket]["pnl"][PRIMARY_H]) > 0),
        "symbols_total": len(per),
    }


def run(pool) -> dict:
    per = [run_symbol(pool, s) for s in UNIVERSE]
    per = [r for r in per if not r.get("skipped")]
    delev = _pool_sub(per, "DELEV")
    relev = _pool_sub(per, "RELEV")
    delev["verdict"] = _verdict(delev, relev)
    return {"per_symbol": per, "delev": delev, "relev": relev}


def _verdict(d: dict, r: dict) -> dict:
    if d["n_S"] < MIN_N:
        return {"label": "功效不足/暂不可测", "reason": f"DELEV 样本 {d['n_S']} < {MIN_N}，去前向积累"}
    c2 = d["mean_pnl"] > 0 and d["ci"][0] > 0
    c3 = d["mean_pnl"] > d["null_upper"]
    c4 = d["hit"] > 0.5
    c5 = d["symbols_positive"] >= 3
    checks = {"②净期望>0且CI下限>0": c2, "③超随机择时零分布": c3,
              "④命中>50%": c4, "⑤≥3标的正": c5}
    # 内部一致性（探索，不进裁决）：机制为真应 DELEV fade>0 且 RELEV fade<0
    consistent = d["mean_pnl"] > 0 and r["mean_pnl"] < 0
    if all(checks.values()):
        label = "有戏（promising）→ Phase 4 前向确认" + ("（且 OI 对照一致）" if consistent else "（但 OI 对照不一致，存疑）")
    elif d["mean_pnl"] < 0:
        label = "无 edge（去杠杆子集 fade 仍亏）→ 杀掉 H4，记 DELEV/RELEV 对照"
    else:
        label = "无 edge → 杀掉 H4"
    return {"label": label, "checks": checks, "consistent": consistent}


def _f(x, dd=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{dd}f}"


def _print_sub(name: str, p: dict) -> None:
    print(f"  [{name}] 触发 {p['n_S']}（多 {p['n_long']}/空 {p['n_short']}）  "
          f"净PnL={_f(p['mean_pnl'])}  CI下限={_f(p['ci'][0])}  命中={_f(p['hit'],3)}  "
          f"零分布上限={_f(p['null_upper'])}  标的正 {p['symbols_positive']}/{p['symbols_total']}")


def print_report(res: dict) -> None:
    print("=" * 84)
    print("H4 回测：爆仓级联 × OI 去杠杆 → 4h fade  [预注册 doc/phase0-H4-...]")
    print("=" * 84)
    print(f"{'标的':<10}{'级联触发':>8}{'OI缺':>6}{'DELEV多/空':>12}{'RELEV多/空':>12}")
    for r in res["per_symbol"]:
        de, rl = r["subs"]["DELEV"], r["subs"]["RELEV"]
        ds, rs = f"{de['nl']}/{de['ns']}", f"{rl['nl']}/{rl['ns']}"
        print(f"{r['symbol']:<10}{r['n_trig']:>8}{r['n_oimiss']:>6}{ds:>12}{rs:>12}")
    print("-" * 84)
    _print_sub("DELEV 去杠杆=主裁决", res["delev"])
    _print_sub("RELEV 加仓=对照(探索)", res["relev"])
    print("-" * 84)
    v = res["delev"]["verdict"]
    if "checks" in v:
        print(f"  [{'PASS' if res['delev']['n_S'] >= MIN_N else 'FAIL'}] ①DELEV 样本 ≥ {MIN_N}")
        for k, ok in v["checks"].items():
            print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"  内部一致性(探索): DELEV fade>0 且 RELEV fade<0 = {v['consistent']}")
    print(f"\n  裁决：{v['label']}")
    if "reason" in v:
        print(f"        {v['reason']}")
    print("=" * 84)


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        print_report(run(pool))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
