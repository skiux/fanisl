"""H1 回测：资金费率极端负 → 4h 均值回归（做多）。

预注册见 doc/phase0-H1-funding-reversion-prereg.md。所有阈值/判据来自预注册，**不在此调参**。
确定性、无 Claude。既是 H1 的检验，也是 Phase 1 回测能力的验收用例。

跑：`python -m analyzer.research.h1`
"""

from __future__ import annotations

from datetime import timedelta

from ..config import get_settings
from ..db import make_pool
from . import pit, stats

# ---- 预注册锁定的参数（不可在此调）----
UNIVERSE = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT"]
PCT_WINDOW = timedelta(days=30)     # 分位回看窗
PCT_THRESH = 0.15                   # 时间加权分位 ≤ 15% 且 funding<0 才触发
DEDUP_GAP = timedelta(hours=12)     # 触发去重叠
HORIZONS_H = [4, 8, 12]             # 主 horizon = 4h，其余仅记录
PRIMARY_H = 4
BAR_TOL = timedelta(minutes=90)     # 找前向价的容差（price 是 1h bar）
COST = 0.0014                       # 往返 taker(5)+slippage(2)bp ≈ 14bps
MIN_N = 40                          # 合并去重叠后样本下限（不足则判"功效不足"）


def _fwd_net(price: list[pit.Point], signal_ts, horizon_h: int) -> float | None:
    """信号在 signal_ts，从其后第一根 bar 进场，+horizon_h 后出场，做多净收益（扣成本）。"""
    entry = pit.first_after(price, signal_ts)
    if entry is None:
        return None
    exit_pt = pit.value_at_or_after(price, entry[0] + timedelta(hours=horizon_h), BAR_TOL)
    if exit_pt is None or entry[1] <= 0:
        return None
    gross = (exit_pt[1] - entry[1]) / entry[1]   # 做多
    return gross - COST


def run_symbol(pool, symbol: str) -> dict:
    funding = pit.load_series(pool, symbol, "funding_rate")
    price = pit.load_series(pool, symbol, "price")
    atr = pit.load_series(pool, symbol, "atr_pct_1h")
    if not funding or not price:
        return {"symbol": symbol, "skipped": "无 funding/price 数据"}

    # 触发候选：funding<0 且 30d 时间加权分位 ≤ 阈值（严格历史）
    cand = []
    for ts, fval in funding:
        if fval >= 0:
            continue
        p = pit.tw_percentile_at(funding, ts, PCT_WINDOW)
        if p is not None and p <= PCT_THRESH:
            cand.append(ts)
    triggers = pit.dedup_by_gap(cand, DEDUP_GAP)

    def collect(times):
        out = {h: [] for h in HORIZONS_H}
        radj = {h: [] for h in HORIZONS_H}
        for ts in times:
            a = pit.asof(atr, ts)
            for h in HORIZONS_H:
                net = _fwd_net(price, ts, h)
                if net is None:
                    continue
                out[h].append(net)
                if a:
                    radj[h].append(net / a)   # 除以进场时已知 ATR%（单位一致即可比）
        return out, radj

    s_net, s_radj = collect(triggers)
    # 无条件基线 = 所有 funding 观测点
    u_net, u_radj = collect([t for t, _ in funding])

    return {
        "symbol": symbol, "n_triggers": len(triggers), "n_uncond": len(funding),
        "atr_median": _median([v for _, v in atr]) if atr else None,
        "s_net": s_net, "s_radj": s_radj, "u_net": u_net, "u_radj": u_radj,
    }


def _median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else None


def run(pool) -> dict:
    per = [run_symbol(pool, s) for s in UNIVERSE]
    per = [r for r in per if "skipped" not in r]
    # 合并（主 horizon）
    S_net = [x for r in per for x in r["s_net"][PRIMARY_H]]
    S_radj = [x for r in per for x in r["s_radj"][PRIMARY_H]]
    U_net = [x for r in per for x in r["u_net"][PRIMARY_H]]
    U_radj = [x for r in per for x in r["u_radj"][PRIMARY_H]]
    n = len(S_net)

    pooled = {
        "n_S": n, "n_U": len(U_net),
        "mean_net_S": stats.mean(S_net), "mean_net_U": stats.mean(U_net),
        "mean_radj_S": stats.mean(S_radj), "mean_radj_U": stats.mean(U_radj),
        "hit_S": stats.hit_rate(S_net), "hit_U": stats.hit_rate(U_net),
        "ci_radj_S": stats.bootstrap_ci(S_radj, lo=5.0, hi=95.0) if S_radj else (float("nan"),) * 2,
        "rand_null_upper_radj": stats.random_null_upper(U_radj, n) if (U_radj and n) else float("nan"),
        "symbols_positive": sum(1 for r in per if r["s_net"][PRIMARY_H]
                                and stats.mean(r["s_net"][PRIMARY_H]) > 0),
        "symbols_total": len(per),
    }
    pooled["verdict"] = _verdict(pooled)
    return {"per_symbol": per, "pooled": pooled}


def _verdict(p: dict) -> dict:
    n = p["n_S"]
    if n < MIN_N:
        return {"label": "功效不足/暂不可测", "reason": f"样本 {n} < {MIN_N}，不下 edge 结论，去前向积累"}
    c2 = p["mean_radj_S"] > p["mean_radj_U"] and p["ci_radj_S"][0] > p["mean_radj_U"]
    c3 = p["hit_S"] > p["hit_U"] and p["hit_S"] > 0.5
    c4 = p["symbols_positive"] >= 3
    c5 = p["mean_net_S"] > 0
    checks = {"②风险调整显著优于基线": c2, "③命中率优于基线且>50%": c3,
              "④≥3标的同向为正": c4, "⑤扣成本净期望>0": c5}
    if all(checks.values()):
        label = "有戏（promising）→ 进 Phase 4 前向确认"
    elif p["mean_net_S"] < p["mean_net_U"]:
        label = "无 edge（疑似动量而非反转）→ 杀掉 H1，记录反向线索"
    else:
        label = "无 edge → 杀掉 H1，记录负结果"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def print_report(res: dict) -> None:
    print("=" * 78)
    print("H1 回测：资金费率极端负 → 4h 均值回归（做多）  [预注册 doc/phase0-H1-...]")
    print("=" * 78)
    print(f"{'标的':<10}{'触发数':>7}{'无条件':>8}{'净均值S':>10}{'净均值U':>10}{'命中S':>8}{'命中U':>8}{'ATR中位':>9}")
    for r in res["per_symbol"]:
        sn, un = r["s_net"][PRIMARY_H], r["u_net"][PRIMARY_H]
        print(f"{r['symbol']:<10}{r['n_triggers']:>7}{r['n_uncond']:>8}"
              f"{_f(stats.mean(sn)):>10}{_f(stats.mean(un)):>10}"
              f"{_f(stats.hit_rate(sn),2):>8}{_f(stats.hit_rate(un),2):>8}{_f(r['atr_median']):>9}")
    p = res["pooled"]
    print("-" * 78)
    print(f"合并(主 horizon +{PRIMARY_H}h)：触发 {p['n_S']} / 无条件 {p['n_U']}")
    print(f"  风险调整均值  S={_f(p['mean_radj_S'])}  U={_f(p['mean_radj_U'])}  "
          f"S的95%单边CI下限={_f(p['ci_radj_S'][0])}  随机零分布上限={_f(p['rand_null_upper_radj'])}")
    print(f"  净收益均值    S={_f(p['mean_net_S'])}  U={_f(p['mean_net_U'])}（已扣 {COST*1e4:.0f}bps）")
    print(f"  命中率        S={_f(p['hit_S'],3)}  U={_f(p['hit_U'],3)}")
    print(f"  标的同向为正  {p['symbols_positive']}/{p['symbols_total']}")
    print("-" * 78)
    v = p["verdict"]
    if "checks" in v:
        for k, ok in v["checks"].items():
            print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"  [{'PASS' if p['n_S'] >= MIN_N else 'FAIL'}] ①样本量 ≥ {MIN_N}")
    print(f"\n  裁决：{v['label']}")
    if "reason" in v:
        print(f"        {v['reason']}")
    print("=" * 78)


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        print_report(run(pool))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
