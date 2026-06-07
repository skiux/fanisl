"""CoinDesk Data（原 CryptoCompare）新闻（免费 key）。

聚合 150+ 源的加密新闻。给 symbol 时按 categories 过滤该币相关；否则取大盘新闻。
让 Claude 读标题判信源/是否已 price-in——这是它比量化强的地方。best-effort。
"""

from __future__ import annotations

from datetime import datetime, timezone

from ._http import get_json
from .catalysts import NewsProvider

_BASE = "https://min-api.cryptocompare.com/data/v2/news/"
_LIMIT = 10


class CryptoCompareNewsSource(NewsProvider):
    name = "cryptocompare"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        if not self._key:
            return None
        try:
            params = {"lang": "EN", "api_key": self._key}
            base = symbol.split("/")[0].split(":")[0].upper() if symbol else None
            if base:
                params["categories"] = base
            data = get_json("CryptoCompare", _BASE, params=params)
            rows = _parse_news(data)
            if not rows and base:
                # 该币无专属分类/无新闻 → 回退大盘新闻
                data = get_json(
                    "CryptoCompare", _BASE, params={"lang": "EN", "api_key": self._key}
                )
                rows = _parse_news(data)
            return rows or None
        except Exception:  # noqa: BLE001 — best-effort
            return None


def _parse_news(data: dict) -> list[dict]:
    arts = data.get("Data") if isinstance(data, dict) else None
    if not isinstance(arts, list):
        return []
    out = []
    for a in arts[:_LIMIT]:
        ts = a.get("published_on")
        out.append(
            {
                "published_at": _iso(ts),
                "title": a.get("title") or "",
                "source": (a.get("source_info") or {}).get("name") or a.get("source"),
                "url": a.get("url"),
            }
        )
    return out


def _iso(ts) -> str:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return ""
