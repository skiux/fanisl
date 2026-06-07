"""Alternative.me 加密恐惧贪婪指数（公开 API，无需 key）。

综合波动率/动量/社媒/Google Trends 的市场温度计。粗但够用，**当确认信号**：
极值(极度恐惧/极度贪婪)往往是反指。全市场单一数值，不分币种。
"""

from __future__ import annotations

from ._http import get_json
from .derivatives import FearGreedProvider

_BASE = "https://api.alternative.me/fng/"

# value_classification → 归一化 state
_STATE = {
    "extreme fear": "extreme_fear",
    "fear": "fear",
    "neutral": "neutral",
    "greed": "greed",
    "extreme greed": "extreme_greed",
}


class AlternativeMeSource(FearGreedProvider):
    name = "alternative.me"

    def fetch_fear_greed(self) -> dict | None:
        try:
            data = get_json("Alternative.me", _BASE, params={"limit": 1})
            rows = data.get("data") or []
            if not rows:
                return None
            r = rows[0]
            value = int(r["value"])
            label = str(r.get("value_classification") or "")
            return {
                "value": value,
                "label": label,
                "state": _STATE.get(label.strip().lower()) or _bucket(value),
            }
        except Exception:  # noqa: BLE001 — best-effort
            return None


def _bucket(value: int) -> str:
    """没有分类文案时按数值兜底分桶。"""
    if value <= 24:
        return "extreme_fear"
    if value <= 44:
        return "fear"
    if value <= 55:
        return "neutral"
    if value <= 74:
        return "greed"
    return "extreme_greed"
