"""H19 回测：EIA 库存 surprise → WTI **盘中**漂移（1h 粒度，H18 的粒度续问）。

预注册见 doc/phase3-H19-eia-intraday-prereg.md。判据锁死，**不调参**。
surprise 构造原样复用 h18（build_events/seasonal_z，唯一差异=执行粒度）。
盘中版必须做假期顺延调整：合成周三戳 + 实际周四发布 = 在信号发布前进场（真未来函数）。
跑：`python -m analyzer.research.h19`
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from random import Random
from zoneinfo import ZoneInfo

from ..config import get_settings
from ..db import make_pool
from . import pit, stats
from .h18 import PUB_LAG, Z_TH, build_events, seasonal_z

SYMBOL = "CL"
PRICE_METRIC = "price_1h"          # OANDA WTICO_USD H1（ts=收盘），与 FRED 日线分开
HORIZONS = [4, 8, 24]              # 交易小时（H1 行索引步进）
PRIMARY_H = 8
COST = 0.0010                      # 往返 10bps
ENTRY_MAX_LAG = timedelta(hours=3) # 进场 bar 收盘距发布超过此值（数据洞）→ 丢弃事件
MIN_N = 100
HOLDOUT_MIN_N = 20
SPLIT = datetime(2019, 1, 1, tzinfo=timezone.utc)
_ET = ZoneInfo("America/New_York")
DELAYED_HOUR, DELAYED_MIN = 11, 0  # 顺延日 11:00 ET


# --- 美联邦假日（observed），纯函数可单测 ----------------------------------

def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    off = (weekday - d.weekday()) % 7
    return d + timedelta(days=off + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date) -> date:
    if d.weekday() == 5:   # 周六 → 周五
        return d - timedelta(days=1)
    if d.weekday() == 6:   # 周日 → 周一
        return d + timedelta(days=1)
    return d


def federal_holidays(year: int) -> set[date]:
    """某年美联邦假日的 observed 日期集合（可能含相邻年的溢出，如元旦 observed 12-31）。"""
    hol = [
        _observed(date(year, 1, 1)),            # 元旦
        _nth_weekday(year, 1, 0, 3),             # MLK：1 月第 3 个周一
        _nth_weekday(year, 2, 0, 3),             # 总统日
        _last_weekday(year, 5, 0),               # 阵亡将士：5 月最后一个周一
        _observed(date(year, 7, 4)),             # 独立日
        _nth_weekday(year, 9, 0, 1),             # 劳动节
        _nth_weekday(year, 10, 0, 2),            # 哥伦布日
        _observed(date(year, 11, 11)),           # 退伍军人日
        _nth_weekday(year, 11, 3, 4),            # 感恩节：11 月第 4 个周四
        _observed(date(year, 12, 25)),           # 圣诞
        _observed(date(year + 1, 1, 1)),         # 次年元旦可能 observed 到本年 12-31
    ]
    if year >= 2021:
        hol.append(_observed(date(year, 6, 19)))  # 六月节
    return set(hol)


def adjusted_publish(publish_ts: datetime) -> datetime:
    """假期顺延调整（预注册规则）：联邦假日落在 [period_end−4d, 合成周三] →
    发布改为周四 11:00 ET；该周四也是假日 → 周五 11:00 ET。"""
    period_end = (publish_ts - PUB_LAG).date()          # 周五
    wed = publish_ts.astimezone(_ET).date()             # 合成周三
    hols = federal_holidays(wed.year) | federal_holidays(wed.year - 1)
    window_start = period_end - timedelta(days=4)       # 报告周周一
    shifted = any(window_start <= h <= wed for h in hols)
    if not shifted:
        return publish_ts
    day = wed + timedelta(days=1)                       # 周四
    if day in hols:
        day += timedelta(days=1)                        # 极罕见：周五
    local = datetime(day.year, day.month, day.day, DELAYED_HOUR, DELAYED_MIN, tzinfo=_ET)
    return local.astimezone(timezone.utc)


# --- 盘中事件 PnL -----------------------------------------------------------

def intraday_ret(price: list[pit.Point], adj_pub: datetime, h: int) -> float | None:
    """发布后严格第一根 H1 收盘进场，+h 根 H1 出场；进场距发布 > ENTRY_MAX_LAG → None。
    返回**多头方向**毛收益（方向与成本由调用方叠加）。"""
    ts = [p[0] for p in price]
    i = bisect_right(ts, adj_pub)
    if i >= len(price) or i + h >= len(price):
        return None
    if price[i][0] - adj_pub > ENTRY_MAX_LAG:
        return None
    entry, exit_ = price[i][1], price[i + h][1]
    if entry <= 0:
        return None
    return exit_ / entry - 1.0


def _sign_null_upper(base_rets: list[float], size: int, *, n: int = 10000,
                     seed: int = 3) -> float:
    """随机符号零分布：同一批事件进场时刻，方向掷硬币，抽 size 个的净均值 97.5 分位。"""
    if not base_rets or size <= 0:
        return float("nan")
    rng = Random(seed)
    means = sorted(
        sum(rng.choice((1.0, -1.0)) * rng.choice(base_rets) - COST for _ in range(size)) / size
        for _ in range(n)
    )
    return means[int(0.975 * n)]


def run(pool, window: tuple = (None, None)) -> dict:
    inv = pit.load_series(pool, SYMBOL, "eia_crude_stocks")
    price = pit.load_series(pool, SYMBOL, PRICE_METRIC)
    events = build_events(inv)          # 季节窗吃全历史（1982+），事件受价格覆盖限制
    since, until = window

    s_pnl: dict[int, list[float]] = {h: [] for h in HORIZONS}
    all_sign: list[float] = []          # 探索：全事件符号交易（不判）
    base_rets: list[float] = []         # 零分布池：全部周度事件的 +PRIMARY_H 多头毛收益
    n_long = n_short = 0
    for i, (ts, _p, _d) in enumerate(events):
        adj = adjusted_publish(ts)
        if (since and adj < since) or (until and adj >= until):
            continue
        base = intraday_ret(price, adj, PRIMARY_H)
        if base is None:
            continue
        base_rets.append(base)
        z = seasonal_z(events, i)
        if z is None:
            continue
        d = "short" if z > 0 else "long"
        sign = -1.0 if d == "short" else 1.0
        all_sign.append(sign * base - COST)
        if abs(z) < Z_TH:
            continue
        n_long += d == "long"
        n_short += d == "short"
        for h in HORIZONS:
            r = intraday_ret(price, adj, h)
            if r is not None:
                s_pnl[h].append(sign * r - COST)

    S = s_pnl[PRIMARY_H]
    return {
        "n_S": len(S), "n_long": n_long, "n_short": n_short,
        "mean_pnl": stats.mean(S), "hit": stats.hit_rate(S),
        "ci": stats.bootstrap_ci(S, lo=5.0, hi=95.0) if S else (float("nan"),) * 2,
        "null_upper": _sign_null_upper(base_rets, len(S)),
        "alt_h": {h: stats.mean(s_pnl[h]) for h in HORIZONS},
        "alt_n": {h: len(s_pnl[h]) for h in HORIZONS},
        "all_sign_mean": stats.mean(all_sign), "all_sign_n": len(all_sign),
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
        label = "有戏（in-sample 全过 且 holdout 站住）→ Phase 4 前向"
    elif all(checks.values()):
        label = "in-sample 过但 HOLDOUT 崩 → KILLED（不得挪判据）"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks, "holdout_ok": ho_ok}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def _print_block(tag: str, r: dict) -> None:
    print(f"  [{tag}] 触发 {r['n_S']}（多 {r['n_long']}/空 {r['n_short']}；有价事件 {r['n_events_priced']}）  "
          f"净={_f(r['mean_pnl'])}  CI下限={_f(r['ci'][0])}  符号零分布上限={_f(r['null_upper'])}  "
          f"命中={_f(r['hit'],3)}")
    print(f"      各持有(探索)： " + "  ".join(
        f"+{h}h={_f(r['alt_h'][h])}(n={r['alt_n'][h]})" for h in HORIZONS))
    print(f"      全事件符号交易(探索,不判)： 净={_f(r['all_sign_mean'])} (n={r['all_sign_n']})")


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        ins = run(pool, (None, SPLIT))
        hold = run(pool, (SPLIT, None))
        full = run(pool)
        print("=" * 84)
        print(f"H19：EIA 库存 surprise（季节 z，|z|≥{Z_TH}）→ WTI 盘中 +{PRIMARY_H} 交易小时  [1h 粒度]")
        print("=" * 84)
        _print_block("IN-SAMPLE 2008-2018", ins)
        print("-" * 84)
        _print_block("HOLDOUT ≥2019", hold)
        print("-" * 84)
        _print_block("FULL 2008-now", full)
        print("-" * 84)
        v = _verdict(ins, hold)
        if "checks" in v:
            print(f"  [{'PASS' if ins['n_S'] >= MIN_N else 'FAIL'}] ①in-sample 样本≥{MIN_N}")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
            print(f"  [{'PASS' if v['holdout_ok'] else 'FAIL'}] ⑤holdout N≥{HOLDOUT_MIN_N} 且净期望>0（make-or-break）")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 84)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
