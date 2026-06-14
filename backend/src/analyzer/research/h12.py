"""H12 回测：PEAD 横截面组合——按入场季度分桶平均，分散单股 idiosyncratic 方差。

预注册见 doc/phase3-H12-pead-portfolio-prereg.md。承接 H11（精确公告日 PEAD 跨 regime 稳健 +1.3%、
9/10 标的正，但栽在 40 日单股零分布太宽）。H12 扩 universe(~40 股) + 按季度分桶平均，正攻该噪声命门。
事件信号沿用 H11，**不调参**。跑：`python -m analyzer.research.h12`
"""

from __future__ import annotations

import random
from bisect import bisect_right
from datetime import datetime, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .backfill_equity import EQUITY
from .h9 import BENCH, COST, PRIMARY, _spy_by_date

SURPRISE_BARS = 2
DEDUP_DAYS = 25
MIN_BUCKET = 5             # 每季度桶 ≥5 事件才计入（保证分散）
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)


def _events(pool, symbol: str, spy: dict) -> list[tuple]:
    """每个 8-K 公告事件 → (entry_ts, rel_drift, sign)。rel_drift=40日市场调整收益(未带符号未扣费)。"""
    px = pit.load_series(pool, symbol, "price")
    evs = [t for t, _ in pit.load_series(pool, symbol, "earn_8k")]
    if not px or not evs:
        return []
    bar_ts = [p[0] for p in px]
    out = []
    last = None
    for ev in evs:
        if last is not None and (ev - last).days < DEDUP_DAYS:
            continue
        j = bisect_right(bar_ts, ev)                 # 公告次日
        if j - SURPRISE_BARS < 0 or j + 1 >= len(px):
            continue
        # surprise CAR over [j-1, j]（市场调整），仅用 ≤ j
        car = 0.0
        ok = True
        for k in range(j - SURPRISE_BARS + 1, j + 1):
            d0, d1 = px[k - 1][0].date(), px[k][0].date()
            if d0 not in spy or d1 not in spy or px[k - 1][1] <= 0 or spy[d0] <= 0:
                ok = False
                break
            car += (px[k][1] / px[k - 1][1] - 1.0) - (spy[d1] / spy[d0] - 1.0)
        if not ok or car == 0:
            continue
        entry_i, xi = j + 1, j + 1 + PRIMARY
        if xi >= len(px):
            continue
        de, dx = px[entry_i][0].date(), px[xi][0].date()
        if de not in spy or dx not in spy or px[entry_i][1] <= 0 or spy[de] <= 0:
            continue
        rel = (px[xi][1] / px[entry_i][1] - 1.0) - (spy[dx] / spy[de] - 1.0)
        out.append((px[entry_i][0], rel, 1 if car > 0 else -1))
        last = ev
    return out


def _bucket_key(ts) -> tuple:
    return (ts.year, (ts.month - 1) // 3)          # 年-季度


def collect(pool, window: tuple | None = None) -> dict:
    """{季度桶: [(rel_drift, sign)]}，跨 universe 汇总（窗口按 entry_ts 过滤）。"""
    spy = _spy_by_date(pool)
    since, until = window or (None, None)
    buckets: dict[tuple, list] = {}
    for sym in EQUITY:
        for entry_ts, rel, sign in _events(pool, sym, spy):
            if (since and entry_ts < since) or (until and entry_ts >= until):
                continue
            buckets.setdefault(_bucket_key(entry_ts), []).append((rel, sign))
    return buckets


def _bucket_means(buckets: dict) -> list[float]:
    out = []
    for ev in buckets.values():
        if len(ev) >= MIN_BUCKET:
            out.append(stats.mean([s * rel - COST for rel, s in ev]))
    return out


def _null_upper(buckets: dict, *, n: int = 5000, seed: int = 3) -> float:
    """随机符号零分布：保留 rel_drift 与分桶，随机翻 sign，重算"桶均值的grand mean"的 97.5 分位。"""
    big = [(k, [rel for rel, _ in ev]) for k, ev in buckets.items() if len(ev) >= MIN_BUCKET]
    if not big:
        return float("nan")
    rng = random.Random(seed)
    grands = []
    for _ in range(n):
        bm = [stats.mean([(1 if rng.random() < 0.5 else -1) * rel - COST for rel in rels])
              for _, rels in big]
        grands.append(stats.mean(bm))
    grands.sort()
    return grands[int(0.975 * n)]


def _frac_pos(means: list[float]) -> float:
    return sum(1 for m in means if m > 0) / len(means) if means else float("nan")


def run(pool) -> dict:
    ins = collect(pool, (None, SPLIT))
    hold = collect(pool, (SPLIT, None))
    im = _bucket_means(ins)
    hm = _bucket_means(hold)
    n_ev_ins = sum(len(v) for v in ins.values())
    p = {
        "n_buckets": len(im), "n_events": n_ev_ins,
        "grand": stats.mean(im), "ci": stats.bootstrap_ci(im) if im else (float("nan"),) * 2,
        "null_upper": _null_upper(ins), "frac_pos": _frac_pos(im),
        "hold_grand": stats.mean(hm), "hold_buckets": len(hm),
    }
    p["verdict"] = _verdict(p)
    return p


def _verdict(p: dict) -> dict:
    if p["n_buckets"] < 20:
        return {"label": "功效不足", "reason": f"in-sample 桶 {p['n_buckets']} < 20"}
    checks = {
        "②grand>0且CI下限>0": p["grand"] > 0 and p["ci"][0] > 0,
        "③超随机符号零分布": p["grand"] > p["null_upper"],
        "④>50%桶为正": p["frac_pos"] > 0.5,
        "⑤holdout grand>0": p["hold_buckets"] >= 8 and p["hold_grand"] > 0,
    }
    if all(checks.values()):
        label = "有戏（分散后跨 regime 稳健、过随机符号门）→ Phase 4 前向 ★首个 PASS"
    elif p["grand"] <= 0:
        label = "无 edge（组合化后仍非正）→ KILLED"
    else:
        label = "无 edge（组合化未过噪声/holdout 门）→ KILLED"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        p = run(pool)
        print("=" * 80)
        print(f"H12：PEAD 横截面组合（{len(EQUITY)}股，季度桶平均，市场中性 +{PRIMARY}日）")
        print("=" * 80)
        print(f"  in-sample 事件 {p['n_events']}  季度桶 {p['n_buckets']}")
        print(f"  桶均值 grand={_f(p['grand'])}（扣 {COST*1e4:.0f}bps）  桶 bootstrap CI={_f(p['ci'][0])}~{_f(p['ci'][1])}")
        print(f"  随机符号零分布上限={_f(p['null_upper'])}  >0 桶占比={_f(p['frac_pos'],2)}")
        print(f"  holdout 桶 {p['hold_buckets']}  grand={_f(p['hold_grand'])}")
        print("-" * 80)
        v = p["verdict"]
        if "checks" in v:
            print(f"  [{'PASS' if p['n_buckets']>=20 else 'FAIL'}] ①in-sample 桶≥20")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 80)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
