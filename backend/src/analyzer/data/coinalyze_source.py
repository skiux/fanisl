"""Coinalyze 爆仓数据源（免费 key，聚合 30+ 所）。

Coinalyze 没有"聚合符号"，要先 /future-markets 列出某币各所的永续符号，再对它们批量取
/liquidation-history，自己跨所求和。免费档 40 次/分；intraday 数据只留最近约 1500~2000 根。

注意：response 字段形状以 Coinalyze 官方文档为准，拿到 key 后需联网核验一次再信数。
全部 best-effort：失败返回 None。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

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

    def _get(self, path: str, params: dict | None = None, *,
             retries: int = 5, backoff: float = 18.0):
        """带限流退避的 GET：免费档 40/min，超限时 Coinalyze 返回 {"message":"Too Many..."}
        而非 HTTP 错误，这里识别并退避重试。失败/异常返回 None（best-effort）。"""
        for i in range(retries):
            try:
                data = get_json("Coinalyze", f"{_BASE}/{path}",
                                params=params or {}, headers=self._headers())
            except Exception:  # noqa: BLE001 — 429 走 HTTP 异常路径，也当限流退避重试
                if i < retries - 1:
                    time.sleep(backoff)
                    continue
                return None
            if isinstance(data, dict) and "Too Many" in str(data.get("message", "")):
                time.sleep(backoff)
                continue
            return data
        return None

    def _perp_symbols(self, base: str) -> list[str]:
        """该币各所的永续合约符号（Coinalyze 自有符号，如 BTCUSDT_PERP.A）。"""
        if self._markets is None:
            data = self._get("future-markets")
            if not isinstance(data, list):
                return []  # 限流/失败不缓存空结果，下次重试
            self._markets = data
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

    def fetch_liquidation_history(
        self, base: str, *, days: int = 180, interval: str = "1hour", max_symbols: int = 20,
    ) -> list[tuple[datetime, float, float]]:
        """回填用：跨所聚合的**逐桶**爆仓历史。返回 [(ts_utc, long_usd, short_usd)] 升序。

        与 fetch_liquidations(近24h聚合) 不同——这里给每个时间桶的多/空被爆金额（USD），
        用于研究/回测（爆仓级联是 H3 的信号）。免费档 1hour 实测可回看 ~180 天。best-effort 返回 []。
        """
        if not self._key:
            return []
        symbols = self._perp_symbols(base)
        if not symbols:
            return []
        now = int(time.time())
        data = self._get("liquidation-history", {
            "symbols": ",".join(symbols[:max_symbols]),
            "interval": interval,
            "from": now - days * 86400,
            "to": now,
            "convert_to_usd": "true",
        })
        if not isinstance(data, list):
            return []
        buckets: dict[int, list[float]] = {}  # t -> [long, short]
        for series in data:
            for pt in series.get("history") or []:
                t = pt.get("t")
                if t is None:
                    continue
                b = buckets.setdefault(int(t), [0.0, 0.0])
                b[0] += float(pt.get("l") or 0.0)
                b[1] += float(pt.get("s") or 0.0)
        return [
            (datetime.fromtimestamp(t, tz=timezone.utc), lo, sh)
            for t, (lo, sh) in sorted(buckets.items())
        ]

    def fetch_oi_history(
        self, base: str, *, days: int = 180, interval: str = "1hour", max_symbols: int = 20,
    ) -> list[tuple[datetime, float]]:
        """回填用：跨所聚合的逐桶持仓量（USD）。返回 [(ts_utc, oi_usd)] 升序。

        Coinalyze /open-interest-history 返回各所 OI 的 OHLC（convert_to_usd），这里对齐桶
        **求和各所 close**得到全市场 OI。供 H4（级联 × OI 去杠杆）用。best-effort 返回 []。
        """
        if not self._key:
            return []
        symbols = self._perp_symbols(base)
        if not symbols:
            return []
        now = int(time.time())
        data = self._get("open-interest-history", {
            "symbols": ",".join(symbols[:max_symbols]),
            "interval": interval,
            "from": now - days * 86400,
            "to": now,
            "convert_to_usd": "true",
        })
        if not isinstance(data, list):
            return []
        buckets: dict[int, float] = {}  # t -> Σ各所 close OI
        for series in data:
            for pt in series.get("history") or []:
                t = pt.get("t")
                if t is None:
                    continue
                buckets[int(t)] = buckets.get(int(t), 0.0) + float(pt.get("c") or 0.0)
        return [
            (datetime.fromtimestamp(t, tz=timezone.utc), oi)
            for t, oi in sorted(buckets.items())
        ]


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
