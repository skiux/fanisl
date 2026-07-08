"""H16 回测:横截面相对强度动量(美股 12-1,月调仓,多前8/空后8,市场中性)。

预注册见 doc/phase3-H16-xsection-momentum-prereg.md。参数锁死,**不调参**。
与已死的 TS 动量(H5/H5b/H7)本质不同:互相比 + 多空对冲(定义上剔除大盘 beta/regime)。
判据③=随机选股零分布(保留每月真实横截面,只打乱选择),直接测"12-1 排序"的信息量。
确定性、无 Claude。跑:`python -m analyzer.research.h16`
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .backfill_equity import EQUITY

LOOKBACK = 252          # 12 个月(交易日)
SKIP = 21               # 跳过最近一月(12-1)
REBAL = 21              # 调仓间隔(交易日)
N_SIDE = 8              # 前/后各 8 名(≈五分位)
MIN_NAMES = 30          # 有效标的不足则跳月
COST_M = 0.0010         # 每月成本 10bps
MIN_MONTHS = 60
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)


def _monthly_cross_sections(pool, universe: list[str] | None = None) -> list[dict]:
    """按 SPY 日历构建每个调仓月:{ts, rets: {sym: 持有月收益}, moms: {sym: 12-1 动量}}。"""
    spy = pit.load_series(pool, "SPY", "price")
    cal = [t.date() for t, _ in spy]
    idx = {d: i for i, d in enumerate(cal)}
    # 每股按 SPY 日历对齐成 close 数组(缺日=None)
    aligned: dict[str, list] = {}
    for sym in (universe or EQUITY):
        px = pit.load_series(pool, sym, "price")
        col = [None] * len(cal)
        for t, v in px:
            i = idx.get(t.date())
            if i is not None:
                col[i] = v
        aligned[sym] = col

    months = []
    m = LOOKBACK + SKIP
    while m + REBAL + 1 < len(cal):
        moms, rets = {}, {}
        for sym, col in aligned.items():
            c_now, c_back = col[m - SKIP], col[m - LOOKBACK]
            c_in, c_out = col[m + 1], col[m + REBAL + 1]
            if None in (c_now, c_back, c_in, c_out) or c_back <= 0 or c_in <= 0:
                continue
            moms[sym] = c_now / c_back - 1.0
            rets[sym] = c_out / c_in - 1.0
        if len(moms) >= MIN_NAMES:
            ts = datetime(cal[m].year, cal[m].month, cal[m].day, tzinfo=timezone.utc)
            months.append({"ts": ts, "moms": moms, "rets": rets})
        m += REBAL
    return months


def _ls_return(moms: dict, rets: dict) -> float:
    ranked = sorted(moms, key=moms.get)
    short = ranked[:N_SIDE]
    long = ranked[-N_SIDE:]
    return (sum(rets[s] for s in long) / N_SIDE
            - sum(rets[s] for s in short) / N_SIDE) - COST_M


def _random_null_upper(months: list[dict], *, n: int = 2000, seed: int = 16) -> float:
    """随机选股零分布:每月同批有效标的随机 8多/8空(保留真实横截面收益),全历史均值的 97.5 分位。"""
    if not months:
        return float("nan")
    rng = random.Random(seed)
    grands = []
    for _ in range(n):
        vals = []
        for mo in months:
            syms = list(mo["rets"])
            rng.shuffle(syms)
            vals.append((sum(mo["rets"][s] for s in syms[-N_SIDE:]) / N_SIDE
                         - sum(mo["rets"][s] for s in syms[:N_SIDE]) / N_SIDE) - COST_M)
        grands.append(stats.mean(vals))
    grands.sort()
    return grands[int(0.975 * n)]


def run(pool, universe: list[str] | None = None) -> dict:
    months = _monthly_cross_sections(pool, universe)
    ins = [mo for mo in months if mo["ts"] < SPLIT]
    hold = [mo for mo in months if mo["ts"] >= SPLIT]
    ins_ls = [_ls_return(mo["moms"], mo["rets"]) for mo in ins]
    hold_ls = [_ls_return(mo["moms"], mo["rets"]) for mo in hold]
    p = {
        "n_ins": len(ins_ls), "mean": stats.mean(ins_ls),
        "ci": stats.bootstrap_ci(ins_ls, lo=5.0, hi=95.0) if ins_ls else (float("nan"),) * 2,
        "null_upper": _random_null_upper(ins), "hit": stats.hit_rate(ins_ls),
        "n_hold": len(hold_ls), "hold_mean": stats.mean(hold_ls),
        "hold_hit": stats.hit_rate(hold_ls),
        "hold_ci": stats.bootstrap_ci(hold_ls, lo=5.0, hi=95.0) if hold_ls else (float("nan"),) * 2,
        "worst_ins": min(ins_ls) if ins_ls else float("nan"),
        "worst_hold": min(hold_ls) if hold_ls else float("nan"),
    }
    p["verdict"] = _verdict(p)
    return p


def _verdict(p: dict) -> dict:
    if p["n_ins"] < MIN_MONTHS:
        return {"label": "功效不足", "reason": f"in-sample 月数 {p['n_ins']} < {MIN_MONTHS}"}
    checks = {
        "②月均>0且CI下限>0": p["mean"] > 0 and p["ci"][0] > 0,
        "③超随机选股零分布": p["mean"] > p["null_upper"],
        "④>50%月份正": p["hit"] > 0.5,
        "⑤holdout 月数≥30 且 mean>0": p["n_hold"] >= 30 and p["hold_mean"] > 0,
    }
    if all(checks.values()):
        label = "有戏(横截面动量成立、超随机选股、跨 regime)→ Phase 4 前向 ★"
    elif p["mean"] <= 0:
        label = "无 edge(12-1 多空在本 universe 扣费后非正)→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        p = run(pool)
        print("=" * 84)
        print(f"H16:横截面 12-1 动量(40 大盘股,月调仓,多前{N_SIDE}/空后{N_SIDE},市场中性,扣{COST_M*1e4:.0f}bps/月)")
        print("=" * 84)
        print(f"  [IN-SAMPLE <2019] 月数 {p['n_ins']}  月均={_f(p['mean'])}  CI=[{_f(p['ci'][0])},{_f(p['ci'][1])}]")
        print(f"      随机选股零分布上限={_f(p['null_upper'])}  月份正={_f(p['hit'], 2)}  最差月={_f(p['worst_ins'])}")
        print(f"  [HOLDOUT ≥2019] 月数 {p['n_hold']}  月均={_f(p['hold_mean'])}  CI=[{_f(p['hold_ci'][0])},{_f(p['hold_ci'][1])}]")
        print(f"      月份正={_f(p['hold_hit'], 2)}  最差月={_f(p['worst_hold'])}")
        print("-" * 84)
        v = p["verdict"]
        if "checks" in v:
            print(f"  [{'PASS' if p['n_ins'] >= MIN_MONTHS else 'FAIL'}] ①in-sample 月数≥{MIN_MONTHS}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"\n  裁决:{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 84)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
