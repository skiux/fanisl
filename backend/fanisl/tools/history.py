"""get_metric_history：从持久化的时间序列读历史，给 Claude 做趋势/分位/拐点推理。

数据来自后台采集器写入的 metric_samples（marketstore）。窗口换算成 since 后取序列、
逐指标摘要（analytics.summarize_series）。采集刚起步时样本少属正常。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..analytics import summarize_series
from ..marketstore import MarketStore

_WINDOW_HOURS: dict[str, int | None] = {
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
    "90d": 24 * 90,
    "all": None,
}


def get_metric_history(
    symbol: str, metrics: list[str], window: str | None, store: MarketStore
) -> dict:
    win = window if window in _WINDOW_HOURS else "30d"
    hours = _WINDOW_HOURS[win]
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=hours)).isoformat() if hours is not None else None
    series = store.get_series(symbol, metrics, since)
    return {
        "symbol": symbol,
        "window": win,
        "metrics": {m: summarize_series(series.get(m) or [], now=now) for m in metrics},
    }
