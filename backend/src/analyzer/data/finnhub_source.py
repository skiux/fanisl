"""Finnhub 新闻源（需 key）。

加密用 /news?category=crypto 的大盘加密流，按 related/标题做 best-effort 相关性过滤。
字段：headline/summary(正文片段)/source/url/image/related(相关标的)/datetime。
字段形状以 Finnhub 文档为准，拿到 key 后联网核验。
"""

from __future__ import annotations

from datetime import datetime, timezone

from ._http import get_json
from .catalysts import NewsProvider

_BASE = "https://finnhub.io/api/v1/news"
_LIMIT = 10


class FinnhubNewsSource(NewsProvider):
    name = "finnhub"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        if not self._key:
            return None
        base = symbol.split("/")[0].split(":")[0].upper() if symbol else None
        try:
            data = get_json(
                "Finnhub", _BASE, params={"category": "crypto", "token": self._key}
            )
            return _parse_finnhub(data, base)
        except Exception:  # noqa: BLE001
            return None


def _parse_finnhub(data, base: str | None) -> list[dict]:
    if not isinstance(data, list):
        return []
    items = []
    for a in data:
        related = str(a.get("related") or "")
        items.append(
            {
                "published_at": _iso(a.get("datetime")),
                "title": a.get("headline") or "",
                "source": a.get("source"),
                "url": a.get("url"),
                "summary": (a.get("summary") or "")[:600] or None,
                "tickers": [t for t in related.replace(";", ",").split(",") if t][:8],
                "categories": [a["category"]] if a.get("category") else [],
                "image_url": a.get("image") or None,
                "provider": "finnhub",
            }
        )
    # 相关性过滤：优先 related/标题含该币；不足则回退大盘加密流
    if base:
        rel = [
            it
            for it in items
            if base in [t.upper() for t in it["tickers"]] or base in it["title"].upper()
        ]
        if len(rel) >= 3:
            return rel[:_LIMIT]
    return items[:_LIMIT]


def _iso(ts) -> str:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return ""
