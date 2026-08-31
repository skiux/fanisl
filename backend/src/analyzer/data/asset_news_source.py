"""按标的取新闻：Finnhub `/company-news`（个股与 ETF）。

**只做有 ticker 的标的。** 指数、贵金属、原油、利率没有公司新闻源；2026-08-30 实测过
用 NewsAPI 关键词兜底（`q=gold price`），首条返回的是一则加密清算新闻——相关性差到会
污染页面，**不如如实留空**。所以这里不做关键词兜底，别再试一遍。

与 `data/news_aggregate.py` 的分工：那条是给对话工具用的"当下大盘/某币有什么新闻"，
最新快照语义；这条是给标的页用的**可回溯时间线**，按标的追加入库、永不删旧条。
"""

from __future__ import annotations

import datetime as dt

from ._http import get_json

_BASE = "https://finnhub.io/api/v1/company-news"
_LIMIT = 60


def _iso(ts) -> str | None:
    try:
        return dt.datetime.fromtimestamp(int(ts), tz=dt.timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return None


def fetch_company_news(ticker: str, api_key: str, *, days: int = 14,
                       limit: int = _LIMIT) -> list[dict]:
    """某 ticker 最近 days 天的新闻，按发布时刻倒序。取不到返回 []（不抛）。"""
    if not api_key or not ticker:
        return []
    today = dt.date.today()
    try:
        rows = get_json("Finnhub", _BASE, params={
            "symbol": ticker,
            "from": str(today - dt.timedelta(days=max(1, days))),
            "to": str(today),
            "token": api_key,
        }, timeout=30.0)
    except Exception:  # noqa: BLE001 — best-effort
        return []
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows:
        published_at = _iso(row.get("datetime"))
        title = (row.get("headline") or "").strip()
        if not published_at or not title:
            continue
        out.append({
            "published_at": published_at,
            "title": title,
            "summary": (row.get("summary") or "").strip()[:800] or None,
            "url": row.get("url") or None,
            "source": row.get("source") or None,
            "image_url": row.get("image") or None,
            "provider": "finnhub",
        })
    out.sort(key=lambda item: item["published_at"], reverse=True)
    return out[:limit]
