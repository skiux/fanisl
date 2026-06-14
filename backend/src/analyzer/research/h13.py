"""H13 回测：SUE-based PEAD——季节性随机游走 SUE（免费 XBRL EPS）替代公告反应符号。

预注册见 doc/phase3-H13-sue-pead-prereg.md。唯一相对 H12 的改动 = 信号 sign(公告反应) → sign(SUE)，
其余（8-K 时点、40 股、季度桶、40 日市场中性、随机符号零分布、holdout）全沿用 H12，做干净对照。
复用 h12 的分桶/零分布机制。跑：`python -m analyzer.research.h13`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .backfill_equity import EQUITY
from .h9 import COST, PRIMARY, _spy_by_date
from .h12 import MIN_BUCKET, _bucket_key, _bucket_means, _frac_pos, _null_upper

SURPRISE_DEDUP_DAYS = 25
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)
SEASON = timedelta(days=365)
SEASON_TOL = timedelta(days=50)
STD_WIN = 8                # 季节性差的标准差窗（季）
MIN_HIST = 6              # 至少 6 个季节性差才算 SUE


def _seasonal_diffs(eps: list[tuple]) -> list[float | None]:
    """每季的季节性差 = eps[i] − 最近 ≈1 年前同季 eps；无匹配=None。eps=[(end_date, val)] 升序。"""
    ends = [datetime.strptime(e, "%Y-%m-%d") if isinstance(e, str) else e for e, _ in eps]
    vals = [v for _, v in eps]
    out: list[float | None] = []
    for i in range(len(eps)):
        target = ends[i] - SEASON
        best_j, best_gap = None, SEASON_TOL
        for j in range(i):
            gap = abs(ends[j] - target)
            if gap <= best_gap:
                best_gap, best_j = gap, j
        out.append(vals[i] - vals[best_j] if best_j is not None else None)
    return out


def _events(pool, symbol: str, spy: dict) -> list[tuple]:
    """每个 8-K 公告 → (entry_ts, rel_drift, sign(SUE))。SUE=季节性差/近8季季节性差标准差。"""
    eps_raw = pit.load_series(pool, symbol, "eps_q")          # ts=period_end
    px = pit.load_series(pool, symbol, "price")
    evs = [t for t, _ in pit.load_series(pool, symbol, "earn_8k")]
    if not eps_raw or not px or not evs:
        return []
    eps = [(t, v) for t, v in eps_raw]                        # (period_end_ts, eps)
    eps_ends = [t for t, _ in eps]
    diffs = _seasonal_diffs([(t, v) for t, v in eps])
    bar_ts = [p[0] for p in px]

    out, last = [], None
    for D in evs:
        if last is not None and (D - last).days < SURPRISE_DEDUP_DAYS:
            continue
        # 最近已结束季度：period_end ∈ [D-95d, D-5d] 的最新
        i = bisect_right(eps_ends, D - timedelta(days=5)) - 1
        if i < 0 or (D - eps_ends[i]) > timedelta(days=95):
            continue
        if diffs[i] is None:
            continue
        win = [d for d in diffs[max(0, i - STD_WIN + 1): i + 1] if d is not None]
        if len(win) < MIN_HIST:
            continue
        sd = stats.pstdev(win) if hasattr(stats, "pstdev") else _stdev(win)
        if sd <= 0:
            continue
        sue = diffs[i] / sd
        if sue == 0:
            continue
        j = bisect_right(bar_ts, D)            # 公告次日
        entry_i, xi = j + 1, j + 1 + PRIMARY
        if xi >= len(px):
            continue
        de, dx = px[entry_i][0].date(), px[xi][0].date()
        if de not in spy or dx not in spy or px[entry_i][1] <= 0 or spy[de] <= 0:
            continue
        rel = (px[xi][1] / px[entry_i][1] - 1.0) - (spy[dx] / spy[de] - 1.0)
        out.append((px[entry_i][0], rel, 1 if sue > 0 else -1))
        last = D
    return out


def _stdev(xs: list[float]) -> float:
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / len(xs)) ** 0.5


def collect(pool, window: tuple | None = None) -> dict:
    spy = _spy_by_date(pool)
    since, until = window or (None, None)
    buckets: dict[tuple, list] = {}
    for sym in EQUITY:
        for entry_ts, rel, sign in _events(pool, sym, spy):
            if (since and entry_ts < since) or (until and entry_ts >= until):
                continue
            buckets.setdefault(_bucket_key(entry_ts), []).append((rel, sign))
    return buckets


def run(pool) -> dict:
    ins, hold = collect(pool, (None, SPLIT)), collect(pool, (SPLIT, None))
    im, hm = _bucket_means(ins), _bucket_means(hold)
    p = {
        "n_buckets": len(im), "n_events": sum(len(v) for v in ins.values()),
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
        label = "有戏（真 SUE 救活 PEAD、跨 regime 稳健）→ Phase 4 ★首个 PASS"
    elif p["grand"] <= 0:
        label = "无 edge（真 SUE 也非正）→ KILLED"
    else:
        label = "无 edge（真 SUE 也未过噪声/holdout 门）→ KILLED"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        p = run(pool)
        print("=" * 80)
        print(f"H13：SUE-based PEAD（{len(EQUITY)}股 真SUE，季度桶，市场中性 +{PRIMARY}日）")
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
