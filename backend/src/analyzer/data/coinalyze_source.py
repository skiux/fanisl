"""Coinalyze 爆仓数据源（免费 key，聚合 30+ 所）。

Coinalyze 没有"聚合符号"，要先 /future-markets 列出某币各所的永续符号，再对它们批量取
/liquidation-history，自己跨所求和。免费档 40 次/分；intraday 数据只留最近约 1500~2000 根。

注意：response 字段形状以 Coinalyze 官方文档为准，拿到 key 后需联网核验一次再信数。
全部 best-effort：失败返回 None。
"""

from __future__ import annotations

import time

from ._http import get_json
from .derivatives import LiquidationProvider

_BASE = "https://api.coinalyze.net/v1"
_QUOTES = {"USDT", "USD", "USDC"}


class CoinalyzeSource(LiquidationProvider):
    name = "coinalyze"

    def __init__(self, api_key: str) -> None:
        self._key = api_key
        self._markets: list[dict] | None = None  # /future-markets 缓存

    def _headers(self) -> dict:
        return {"api_key": self._key}

    def _perp_symbols(self, base: str) -> list[str]:
        """该币各所的永续合约符号（Coinalyze 自有符号，如 BTCUSDT_PERP.A）。"""
        if self._markets is None:
            data = get_json(
                "Coinalyze", f"{_BASE}/future-markets", headers=self._headers()
            )
            self._markets = data if isinstance(data, list) else []
        out = []
        for m in self._markets:
            if (
                m.get("is_perpetual")
                and (m.get("base_asset") or "").upper() == base.upper()
                and (m.get("quote_asset") or "").upper() in _QUOTES
            ):
                sym = m.get("symbol")
                if sym:
                    out.append(sym)
        return out

    def fetch_liquidations(self, base: str) -> dict | None:
        if not self._key:
            return None
        try:
            symbols = self._perp_symbols(base)
            if not symbols:
                return None
            now = int(time.time())
            data = get_json(
                "Coinalyze",
                f"{_BASE}/liquidation-history",
                params={
                    "symbols": ",".join(symbols),
                    "interval": "1hour",
                    "from": now - 24 * 3600,
                    "to": now,
                    "convert_to_usd": "true",
                },
                headers=self._headers(),
            )
            return _aggregate(data)
        except Exception:  # noqa: BLE001 — best-effort
            return None


def _aggregate(data: list) -> dict | None:
    """跨所、跨时间桶求和近 24h 多/空被爆金额，并标记最近是否有尖峰。

    data: [{symbol, history:[{t, l(多头被爆), s(空头被爆)}]}]
    """
    if not isinstance(data, list) or not data:
        return None
    long_usd = 0.0
    short_usd = 0.0
    bucket_totals: dict[int, float] = {}  # 每个时间桶的总爆仓，用于尖峰检测
    for series in data:
        for pt in series.get("history") or []:
            li = float(pt.get("l") or 0.0)
            si = float(pt.get("s") or 0.0)
            long_usd += li
            short_usd += si
            t = pt.get("t")
            if t is not None:
                bucket_totals[t] = bucket_totals.get(t, 0.0) + li + si

    total = long_usd + short_usd
    if total <= 0:
        return None

    diff_ratio = abs(long_usd - short_usd) / total
    if diff_ratio < 0.15:
        side = "balanced"
    else:
        side = "long" if long_usd > short_usd else "short"

    spike = False
    if len(bucket_totals) >= 4:
        ordered = [bucket_totals[k] for k in sorted(bucket_totals)]
        last = ordered[-1]
        rest = ordered[:-1]
        avg = sum(rest) / len(rest) if rest else 0.0
        spike = avg > 0 and last >= 3 * avg

    return {
        "long_usd_24h": round(long_usd, 2),
        "short_usd_24h": round(short_usd, 2),
        "total_usd_24h": round(total, 2),
        "dominant_side": side,
        "recent_spike": spike,
    }
