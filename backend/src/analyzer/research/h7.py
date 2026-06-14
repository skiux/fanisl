"""H7 回测：时间序列动量（TSMOM）长 horizon —— 检验拉长持有能否跨过 14bps 成本地板。

预注册见 doc/phase3-H7-tsmom-longhorizon-prereg.md。主参数 L=H=7d，sign-only，**不调参**。
来由：H1-H6 六连 KILLED，诊断="信号存在但 < 成本地板"；H7 试唯一未碰的维度——长 horizon 摊薄固定成本。
PnL/零分布复用 H3。确定性、无 Claude。跑：`python -m analyzer.research.h7`
"""

from __future__ import annotations

from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h3 import COST, MIN_N, _mixed_null_upper, _pnl
from .h6 import MAJORS, SMALLCAP, SYM_POS_FRAC

LOOKBACK = timedelta(days=7)        # 趋势回看
PRIMARY_H = 24 * 7                  # 主持有 7d（小时）
HORIZONS_H = [24, 24 * 3, 24 * 7]   # 1d/3d 仅记录
DEDUP_H = 24 * 7                    # 去重叠 = 主持有
BAR_TOL = timedelta(minutes=90)


def _trail(price: list[pit.Point], t) -> float | None:
    """过去 L 的收益（point-in-time）。基准点须在 t−L 容差内存在，否则视为历史不足、跳过。"""
    pn = pit.asof(price, t)
    base = pit.value_at_or_after(price, t - LOOKBACK, BAR_TOL)  # t−L 附近确有价
    if pn is None or base is None or base[1] <= 0:
        return None
    return pn / base[1] - 1.0


def run_symbol(pool, symbol: str, window: tuple | None = None) -> dict:
    price = pit.load_series(pool, symbol, "price")
    atr = pit.load_series(pool, symbol, "atr_pct_1h")
    if not price:
        return {"symbol": symbol, "skipped": True}

    since, until = window or (None, None)
    cand = []
    for t, _ in price:
        if (since and t < since) or (until and t >= until):
            continue
        r = _trail(price, t)
        if r is None or r == 0:
            continue
        cand.append((t, "long" if r > 0 else "short"))
    trig = []
    for t, d in cand:
        if not trig or t - trig[-1][0] >= timedelta(hours=DEDUP_H):
            trig.append((t, d))

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


def run(pool, universe: list[str], window: tuple | None = None) -> dict:
    per = [run_symbol(pool, s, window) for s in universe]
    per = [r for r in per if not r.get("skipped")]
    S = [x for r in per for x in r["s_pnl"][PRIMARY_H]]
    n_long = sum(r["n_long"] for r in per)
    n_short = sum(r["n_short"] for r in per)
    pool_long = [x for r in per for x in r["pool_long"]]
    pool_short = [x for r in per for x in r["pool_short"]]
    sym_pos = sum(1 for r in per if r["s_pnl"][PRIMARY_H]
                  and stats.mean(r["s_pnl"][PRIMARY_H]) > 0)
    p = {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _mixed_null_upper(pool_long, pool_short, n_long, n_short),
        "mean_radj": stats.mean([x for r in per for x in r["s_radj"]]),
        "symbols_positive": sym_pos, "symbols_total": len(per),
        "alt_h": {h: stats.mean([x for r in per for x in r["s_pnl"][h]]) for h in HORIZONS_H},
    }
    p["verdict"] = _verdict(p)
    return {"per_symbol": per, "pooled": p}


def _verdict(p: dict) -> dict:
    if p["n_S"] < MIN_N:
        return {"label": "功效不足", "reason": f"样本 {p['n_S']} < {MIN_N}"}
    need = SYM_POS_FRAC * p["symbols_total"]
    checks = {
        "②净期望>0且CI下限>0": p["mean_pnl"] > 0 and p["ci"][0] > 0,
        "③超随机择时零分布": p["mean_pnl"] > p["null_upper"],
        "④命中>50%": p["hit"] > 0.5,
        f"⑤≥60%标的正(≥{need:.0f}/{p['symbols_total']})": p["symbols_positive"] >= need,
    }
    if all(checks.values()):
        label = "有戏 → Phase 4 前向 OOS（成本地板被长 horizon 跨过）"
    elif p["mean_pnl"] <= 0:
        label = "无 edge（长 horizon 也跨不过成本地板）→ 杀掉 H7，加固'无简单 edge'"
    else:
        label = "无 edge → 杀掉 H7"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def print_report(res: dict, title: str) -> None:
    print("=" * 80)
    print(f"H7 回测：TSMOM lookback 7d → 持有 7d（sign-only）  [{title}]")
    print("=" * 80)
    print(f"{'标的':<10}{'触发':>6}{'多/空':>9}{'净PnL均值':>12}{'命中':>8}")
    for r in res["per_symbol"]:
        sp = r["s_pnl"][PRIMARY_H]
        ls = f"{r['n_long']}/{r['n_short']}"
        print(f"{r['symbol']:<10}{r['n_triggers']:>6}{ls:>9}"
              f"{_f(stats.mean(sp)):>12}{_f(stats.hit_rate(sp), 2):>8}")
    p = res["pooled"]
    print("-" * 80)
    print(f"合并(主 7d)：触发 {p['n_S']}（多 {p['n_long']}/空 {p['n_short']}）")
    print(f"  净 PnL 均值={_f(p['mean_pnl'])}（扣 {COST*1e4:.0f}bps）  95%单边CI下限={_f(p['ci'][0])}")
    print(f"  随机择时零分布上限={_f(p['null_upper'])}  命中={_f(p['hit'],3)}  "
          f"风险调整={_f(p['mean_radj'])}  标的正 {p['symbols_positive']}/{p['symbols_total']}")
    alt = "  ".join(f"{h//24}d={_f(p['alt_h'][h])}" for h in HORIZONS_H)
    print(f"  各持有净均值(探索)： {alt}")
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
        print_report(run(pool, SMALLCAP), "主：18 小盘")
        print()
        print_report(run(pool, MAJORS), "对照：5 主流")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
