"""Yahoo Finance 日线源（无 key，深历史）——研究回填用，不进实时采集。

走公开 chart 端点 query1.finance.yahoo.com/v8/finance/chart/{sym}，需带 User-Agent。
返回**复权收盘**（adjclose，已调整拆股/分红），做股票前向收益必须用复权价。best-effort 返回 []。
"""

from __future__ import annotations

from datetime import datetime, timezone

from ._http import get_json

_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
_UA = {"User-Agent": "Mozilla/5.0 (compatible; fanisl-research/1.0)"}


def fetch_daily_adjclose(symbol: str, *, start: int = 1262304000) -> list[tuple[datetime, float]]:
    """某标的的日线复权收盘历史 [(ts_utc, adjclose)] 升序。start=起始 unix 秒（默认 2010-01-01）。"""
    now = int(datetime.now(tz=timezone.utc).timestamp())
    try:
        d = get_json("Yahoo", _BASE + symbol,
                     params={"period1": start, "period2": now, "interval": "1d"},
                     headers=_UA, timeout=30.0)
    except Exception:  # noqa: BLE001 — best-effort
        return []
    try:
        r = d["chart"]["result"][0]
        ts = r["timestamp"]
        adj = r["indicators"]["adjclose"][0]["adjclose"]
    except (KeyError, IndexError, TypeError):
        return []
    out = []
    for t, c in zip(ts, adj):
        if t is None or c is None:
            continue
        out.append((datetime.fromtimestamp(int(t), tz=timezone.utc), float(c)))
    return out
