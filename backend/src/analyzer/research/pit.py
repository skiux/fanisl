"""Point-in-time 数据访问与助手（研究/回测专用，严格无未来函数）。

序列 = 按时间升序的 [(ts: datetime, value: float)]，来自 metric_samples 的 sample-and-hold
写入语义（值不变不记），所以"时刻 t 当时已知的值" = ts ≤ t 的最后一个点（asof）。

这里的函数都是纯函数（除 load_series 读库），可单测。回测有效性全靠这层守住"无未来函数"。
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from datetime import datetime, timedelta

from ..analytics import summarize_series

Point = tuple[datetime, float]


def load_series(pool, symbol: str, metric: str, scope: str = "symbol") -> list[Point]:
    """从行情库取某标的某指标的 (ts, value) 升序序列。"""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT ts, value FROM metric_samples "
            "WHERE scope=%s AND symbol=%s AND metric=%s AND value IS NOT NULL ORDER BY ts",
            (scope, symbol, metric),
        ).fetchall()
    return [(r["ts"], float(r["value"])) for r in rows]


def asof(points: list[Point], t: datetime) -> float | None:
    """时刻 t 当时已知的值：ts ≤ t 的最后一个点。无则 None。"""
    ts = [p[0] for p in points]
    i = bisect_right(ts, t) - 1
    return points[i][1] if i >= 0 else None


def first_after(points: list[Point], t: datetime) -> Point | None:
    """t 之后（严格 >）的第一个点。进场用：信号在 t，从下一根 bar 进。"""
    ts = [p[0] for p in points]
    i = bisect_right(ts, t)
    return points[i] if i < len(points) else None


def value_at_or_after(points: list[Point], t: datetime, tol: timedelta) -> Point | None:
    """t（含）之后、距 t 不超过 tol 的第一个点。算前向出场价用（容忍 bar 间隙）。"""
    ts = [p[0] for p in points]
    i = bisect_left(ts, t)
    if i < len(points) and points[i][0] - t <= tol:
        return points[i]
    return None


def dedup_by_gap(times: list[datetime], min_gap: timedelta) -> list[datetime]:
    """去重叠：相邻保留间隔 ≥ min_gap 的，丢掉更密的（保证样本近独立）。"""
    out: list[datetime] = []
    for t in sorted(times):
        if not out or t - out[-1] >= min_gap:
            out.append(t)
    return out


def tw_percentile_at(
    points: list[Point], t: datetime, window: timedelta, *,
    min_points: int = 15, min_lookback_frac: float = 0.93,
) -> float | None:
    """t 时刻，某值在其 [t-window, t] 内的**时间加权分位** ∈ [0,1]（无未来函数）。

    复用 analytics.summarize_series（按持续时长加权，匹配 sample-and-hold）。
    需窗口内有足够历史（点数 ≥ min_points 且实际回看覆盖 ≥ window×min_lookback_frac），
    否则返回 None（早期历史不足时不出信号）。
    """
    lo = t - window
    win = [p for p in points if lo <= p[0] <= t]
    if len(win) < min_points:
        return None
    if (t - win[0][0]) < window * min_lookback_frac:  # 回看历史不够长
        return None
    dicts = [{"ts": p[0].isoformat(), "value": p[1]} for p in win]
    return summarize_series(dicts, now=t).get("time_weighted_percentile")
