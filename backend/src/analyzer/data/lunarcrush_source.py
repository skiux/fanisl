"""LunarCrush 社交情绪/注意力数据源（免费档，单 Bearer key，覆盖 4000+ 币）。

v4 端点：GET https://lunarcrush.com/api4/public/coins/{coin}/v1，Bearer 认证。
取 galaxy_score / alt_rank / social_dominance / sentiment / interactions_24h——
社交热度与注意力。**当确认信号用**，社交量易被机器人灌水。

注意：响应字段形状以 LunarCrush v4 文档为准，拿到 key 后需联网核验一次再信数。
best-effort：失败返回 None。
"""

from __future__ import annotations

from ._http import get_json
from .derivatives import SocialProvider

_BASE = "https://lunarcrush.com/api4/public"


class LunarCrushSource(SocialProvider):
    name = "lunarcrush"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_social(self, base: str) -> dict | None:
        if not self._key:
            return None
        try:
            data = get_json(
                "LunarCrush",
                f"{_BASE}/coins/{base.upper()}/v1",
                headers={"Authorization": f"Bearer {self._key}"},
            )
            d = data.get("data") if isinstance(data, dict) else None
            if not isinstance(d, dict):
                return None
            return _parse_social(d)
        except Exception:  # noqa: BLE001 — best-effort
            return None


def _num(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _parse_social(d: dict) -> dict | None:
    out = {
        "galaxy_score": _num(d.get("galaxy_score")),
        "alt_rank": int(d["alt_rank"]) if d.get("alt_rank") is not None else None,
        "social_dominance": _num(d.get("social_dominance")),
        "sentiment": _num(d.get("sentiment")),
        "interactions_24h": _num(d.get("interactions_24h")),
    }
    # 全空（字段名变动或币不存在）视为拿不到
    if all(v is None for v in out.values()):
        return None
    return out
