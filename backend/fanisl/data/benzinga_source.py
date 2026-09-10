"""Benzinga 新闻源（需 key）——偏金融/股票，也有 Cryptocurrency 频道。

/api/v2/news（必须 accept: application/json，否则返回 XML）。字段丰富：
title/teaser/body/channels(频道)/stocks(标的)/tags/image/created。created 是 RFC822。
字段形状以 Benzinga 文档为准，拿到 key 后联网核验。best-effort。
"""

from __future__ import annotations

from email.utils import parsedate_to_datetime

from ._http import get_json
from .catalysts import NewsProvider

_BASE = "https://api.benzinga.com/api/v2/news"
_LIMIT = 10


class BenzingaNewsSource(NewsProvider):
    name = "benzinga"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        if not self._key:
            return None
        base = symbol.split("/")[0].split(":")[0].upper() if symbol else None
        # 注意：Benzinga tickers 是「股票」代码，加密没有对应 ticker（传 tickers=BTC 会返回空）。
        # 加密走 Cryptocurrency 频道，再按标题做相关性过滤、不足则回退整个频道流。
        try:
            data = get_json(
                "Benzinga",
                _BASE,
                params={
                    "token": self._key,
                    "displayOutput": "full",
                    "pageSize": 25,
                    "channels": "Cryptocurrency",
                },
                headers={"accept": "application/json"},
            )
            items = _parse_benzinga(data)
            if base:
                rel = [
                    it
                    for it in items
                    if base in it["title"].upper()
                    or base in [t.upper() for t in it["tickers"]]
                ]
                if len(rel) >= 3:
                    return rel[:_LIMIT]
            return items[:_LIMIT]
        except Exception:  # noqa: BLE001
            return None


def _parse_benzinga(data) -> list[dict]:
    if not isinstance(data, list):
        return []
    out = []
    for a in data:
        body = a.get("body") or a.get("teaser") or ""
        out.append(
            {
                "published_at": _iso(a.get("created")),
                "title": a.get("title") or "",
                "source": "Benzinga",
                "url": a.get("url"),
                "summary": (a.get("teaser") or body)[:600] or None,
                "tickers": [s.get("name") for s in (a.get("stocks") or []) if s.get("name")][:8],
                "categories": [c.get("name") for c in (a.get("channels") or []) if c.get("name")][:8],
                "image_url": _first_image(a.get("image")),
                "provider": "benzinga",
            }
        )
    return out


def _first_image(img) -> str | None:
    if isinstance(img, list) and img:
        return img[0].get("url") if isinstance(img[0], dict) else None
    return None


def _iso(s) -> str:
    if not s:
        return ""
    try:
        return parsedate_to_datetime(s).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return str(s)
