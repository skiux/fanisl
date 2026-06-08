"""多源新闻聚合：扇出到各子源 → 合并 → 去重 → 按时间倒序 → 截断。

实现 NewsProvider 接口，对 get_catalysts 透明。某个子源失败不影响其余。
去重：优先按 url，否则按标题归一化。
"""

from __future__ import annotations

from .catalysts import NewsProvider

_TOTAL_LIMIT = 20


class MultiNewsProvider(NewsProvider):
    name = "multi"

    def __init__(self, providers: list[NewsProvider]) -> None:
        self._providers = providers

    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        rows: list[dict] = []
        for p in self._providers:
            try:
                got = p.fetch_news(symbol)
            except Exception:  # noqa: BLE001
                got = None
            if got:
                rows.extend(got)
        merged = _dedup(rows)
        return merged or None


def _key(item: dict) -> str:
    url = (item.get("url") or "").strip().rstrip("/")
    if url:
        return url.lower()
    return "".join((item.get("title") or "").lower().split())


def _dedup(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for r in rows:
        k = _key(r)
        if not k:
            continue
        if k not in seen:
            seen[k] = r
    items = list(seen.values())
    items.sort(key=lambda r: r.get("published_at") or "", reverse=True)
    return items[:_TOTAL_LIMIT]
