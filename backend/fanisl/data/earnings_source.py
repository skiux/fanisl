"""财报日历：Finnhub `/calendar/earnings`（个股）。

**为什么不用已有的 `edgar_source`**：EDGAR 给的是 10-Q/10-K 与 8-K Item 2.02 的**备案日**，
PIT 干净、适合研究回填（`research/backfill_eps.py` 就用它）；但标的页要回答的是
"**下次**财报什么时候、市场预期多少"，那是前瞻信息，备案日给不了。两者并存不冲突：
这里管日历与预期，EDGAR 管可回溯的历史事实。

实测（2026-08-30，真 key）：`symbol=NVDA` 取 [今天-400, 今天+180] 返回 3 条——
两条未来（带 epsEstimate/revenueEstimate、epsActual 为 null）+ 一条已公布（epsActual 2.22
vs 预期 2.1384）。**ETF 返回 0 条**（SOXX 实测），所以只对个股问。
"""

from __future__ import annotations

import datetime as dt

from ._http import get_json

_BASE = "https://finnhub.io/api/v1/calendar/earnings"

# hour 字段的取值 → 中文（Finnhub 用 bmo/amc/dmh 三种）
SESSION_LABELS = {"bmo": "盘前", "amc": "盘后", "dmh": "盘中"}


def fetch_earnings(ticker: str, api_key: str, *, back_days: int = 400,
                   ahead_days: int = 180) -> list[dict]:
    """某 ticker 的财报日历（含已公布的实际值）。取不到返回 []（不抛）。"""
    if not api_key or not ticker:
        return []
    today = dt.date.today()
    try:
        data = get_json("Finnhub", _BASE, params={
            "symbol": ticker,
            "from": str(today - dt.timedelta(days=max(1, back_days))),
            "to": str(today + dt.timedelta(days=max(1, ahead_days))),
            "token": api_key,
        }, timeout=30.0)
    except Exception:  # noqa: BLE001 — best-effort
        return []
    rows = (data or {}).get("earningsCalendar")
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows:
        date = (row.get("date") or "").strip()
        if not date:
            continue
        out.append({
            "event_date": date,
            "session": (row.get("hour") or "").strip() or None,
            "payload": {
                "quarter": row.get("quarter"),
                "fiscal_year": row.get("year"),
                "eps_estimate": row.get("epsEstimate"),
                "eps_actual": row.get("epsActual"),
                "revenue_estimate": row.get("revenueEstimate"),
                "revenue_actual": row.get("revenueActual"),
            },
        })
    out.sort(key=lambda item: item["event_date"])
    return out
