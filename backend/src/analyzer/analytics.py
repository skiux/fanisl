"""时间序列摘要：把一段采样点压成可推理的统计 + 稀疏轨迹（纯函数，可单测）。

给 Claude 读历史用——它需要的是趋势/分位/拐点，而不是几百个原始点。

关键：序列由 write_changed 写入（值不变就不记），所以每个点代表「该值一直持续到下一个点」
的 sample-and-hold 语义。因此均值/分位必须**按持续时长加权**——否则一个只存在 15min 的
尖峰会和一个持续三天的值占同样权重，污染分位/基准率。末点持续到 now。
"""

from __future__ import annotations

from datetime import datetime


def _r(x: float) -> float:
    return round(x, 6)


def _parse_ts(s) -> datetime | None:
    try:
        return datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def _holding_weights(pts: list[dict], now: datetime | None) -> list[float]:
    """各点的持续时长权重（秒）：w_i = ts_{i+1}-ts_i；末点 = now-ts_n。

    时间戳缺失/不可解析/时区不一致时退回等权（与旧的按点计数行为一致），不报错。
    """
    n = len(pts)
    ts = [_parse_ts(p["ts"]) for p in pts]
    if any(t is None for t in ts):
        return [1.0] * n
    try:
        w = [max((ts[i + 1] - ts[i]).total_seconds(), 0.0) for i in range(n - 1)]
        if now is not None:
            last = max((now - ts[-1]).total_seconds(), 0.0)
        else:
            last = (sum(w) / len(w)) if w else 1.0
        w.append(last)
    except TypeError:  # naive/aware 混用等
        return [1.0] * n
    return w


def summarize_series(points: list[dict], now: datetime | None = None, max_traj: int = 16) -> dict:
    """points=[{ts,value}]（按时间升序）。

    返回当前值/极值/**按时长加权**的均值与分位/变化/方向/覆盖时长/稀疏轨迹。
    now：窗口结束时刻（末点持续到此）；省略则用前面间隔均值估计末点权重。
    """
    pts = [p for p in points if p.get("value") is not None]
    n = len(pts)
    if n == 0:
        return {"samples": 0}

    vals = [float(p["value"]) for p in pts]
    current, first = vals[-1], vals[0]
    lo, hi = min(vals), max(vals)

    weights = _holding_weights(pts, now)
    total_w = sum(weights)
    if total_w > 0:
        tw_mean = sum(v * w for v, w in zip(vals, weights)) / total_w
        tw_pct = round(sum(w for v, w in zip(vals, weights) if v < current) / total_w, 3)
    else:  # 所有点同一时刻 → 退回等权
        tw_mean = sum(vals) / n
        tw_pct = round(sum(1 for v in vals if v < current) / n, 3)

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
        "time_weighted_mean": _r(tw_mean),
        "time_weighted_percentile": tw_pct,
        "span_hours": round(total_w / 3600, 2),
        "change_abs": _r(change_abs),
        "change_pct": change_pct,
        "direction": direction,
        "trajectory": _downsample(pts, max_traj),
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
