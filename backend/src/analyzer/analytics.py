"""时间序列摘要：把一段采样点压成可推理的统计 + 稀疏轨迹（纯函数，可单测）。

给 Claude 读历史用——它需要的是趋势/分位/拐点，而不是几百个原始点。
"""

from __future__ import annotations


def _r(x: float) -> float:
    return round(x, 6)


def summarize_series(points: list[dict], max_traj: int = 16) -> dict:
    """points=[{ts,value}]（按时间升序）。返回当前值/极值/均值/窗口内分位/变化/方向/稀疏轨迹。"""
    vals = [float(p["value"]) for p in points if p.get("value") is not None]
    n = len(vals)
    if n == 0:
        return {"samples": 0}

    current = vals[-1]
    first = vals[0]
    lo, hi = min(vals), max(vals)
    mean = sum(vals) / n
    # 当前值在窗口内的分位（0~1）
    pct_in_window = round(sum(1 for v in vals if v < current) / n, 3)
    change_abs = current - first
    change_pct = round(change_abs / first * 100, 3) if first else None

    # 方向：用相对区间幅度的死区，免得不同量纲乱判
    span = hi - lo
    if span == 0 or abs(change_abs) < 0.1 * span:
        direction = "flat"
    else:
        direction = "rising" if change_abs > 0 else "falling"

    return {
        "samples": n,
        "current": _r(current),
        "first": _r(first),
        "min": _r(lo),
        "max": _r(hi),
        "mean": _r(mean),
        "percentile_in_window": pct_in_window,
        "change_abs": _r(change_abs),
        "change_pct": change_pct,
        "direction": direction,
        "trajectory": _downsample(points, max_traj),
    }


def _downsample(points: list[dict], k: int) -> list[list]:
    """等距抽稀到至多 k 个点（保留首尾），输出 [[ts, value], ...]。"""
    pts = [p for p in points if p.get("value") is not None]
    n = len(pts)
    if n <= k:
        chosen = pts
    else:
        idx = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
        chosen = [pts[i] for i in idx]
    return [[p["ts"], _r(float(p["value"]))] for p in chosen]
