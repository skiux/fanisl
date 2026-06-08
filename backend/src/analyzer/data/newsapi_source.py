"""NewsAPI.org 新闻源（需 key）。

/v2/everything 按关键词搜；加密币用名称查（BTC→Bitcoin）。无情绪/标的字段，
存标题/描述/正文片段/来源/配图。best-effort。字段形状以 NewsAPI 文档为准，拿到 key 后联网核验。
"""

from __future__ import annotations

from ._http import get_json
from .catalysts import NewsProvider

_BASE = "https://newsapi.org/v2/everything"
_LIMIT = 10

# 加密币 symbol → 搜索词（NewsAPI 是通用新闻，按名称搜更准）
_COIN_QUERY = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "SOL": "Solana",
    "BNB": "Binance Coin OR BNB",
    "XRP": "XRP OR Ripple",
    "DOGE": "Dogecoin",
    "ADA": "Cardano",
    "AVAX": "Avalanche crypto",
    "ARB": "Arbitrum crypto",
}


class NewsAPISource(NewsProvider):
    name = "newsapi"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        if not self._key:
            return None
        base = symbol.split("/")[0].split(":")[0].upper() if symbol else None
        q = _COIN_QUERY.get(base, base) if base else "cryptocurrency"
        try:
            data = get_json(
                "NewsAPI",
                _BASE,
                params={
                    "q": q,
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": _LIMIT,
                    "apiKey": self._key,
                },
            )
            return _parse_newsapi(data)
        except Exception:  # noqa: BLE001
            return None


def _parse_newsapi(data: dict) -> list[dict]:
    arts = data.get("articles") if isinstance(data, dict) else None
    if not isinstance(arts, list):
        return []
    out = []
    for a in arts[:_LIMIT]:
        desc = a.get("description") or a.get("content") or ""
        out.append(
            {
                "published_at": a.get("publishedAt") or "",
                "title": a.get("title") or "",
                "source": (a.get("source") or {}).get("name"),
                "url": a.get("url"),
                "summary": desc[:600] or None,
                "image_url": a.get("urlToImage"),
                "provider": "newsapi",
            }
        )
    return out
