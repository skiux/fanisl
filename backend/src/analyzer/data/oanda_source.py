"""OANDA v20 数据源：金属（XAU_USD / XAG_USD）等 CFD。

只有 OHLCV，没有衍生品。需要 OANDA_API_TOKEN（demo/practice 或 live 账户）。
未配置 token 时给出清晰报错（由工具层转成结构化错误返回给 Claude）。
"""

from __future__ import annotations

import pandas as pd

from ._http import get_json
from .base import DataSourceError, MarketDataSource, ohlcv_df

_GRAN = {"1h": "H1", "4h": "H4", "1d": "D", "1wk": "W"}


class OANDASource(MarketDataSource):
    name = "oanda"
    supports_derivatives = False

    def __init__(self, token: str = "", practice: bool = True) -> None:
        self.token = token
        self.base = (
            "https://api-fxpractice.oanda.com"
            if practice
            else "https://api-fxtrade.oanda.com"
        )

    def _get(self, path: str, params: dict) -> dict:
        if not self.token:
            raise DataSourceError("OANDA token 未配置（设置 OANDA_API_TOKEN）")
        return get_json(
            "OANDA",
            f"{self.base}{path}",
            params=params,
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=15.0,
        )

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        gran = _GRAN.get(timeframe)
        if gran is None:
            raise DataSourceError(f"OANDA 不支持周期 {timeframe}")
        data = self._get(
            f"/v3/instruments/{symbol}/candles",
            {"granularity": gran, "count": min(limit, 5000), "price": "M"},
        )
        candles = data.get("candles", [])
        if not candles:
            raise DataSourceError(f"{symbol} {timeframe} 无数据")
        return ohlcv_df(
            [
                {
                    "ts": pd.to_datetime(c["time"], utc=True),
                    "open": c["mid"]["o"],
                    "high": c["mid"]["h"],
                    "low": c["mid"]["l"],
                    "close": c["mid"]["c"],
                    "volume": c.get("volume", 0),
                }
                for c in candles
            ]
        )

    def fetch_ticker(self, symbol: str) -> dict:
        data = self._get(
            f"/v3/instruments/{symbol}/candles",
            {"granularity": "D", "count": 2, "price": "M"},
        )
        candles = data.get("candles", [])
        if not candles:
            raise DataSourceError(f"{symbol} 无 ticker")
        last = float(candles[-1]["mid"]["c"])
        prev = float(candles[0]["mid"]["c"]) if len(candles) > 1 else last
        chg = (last - prev) / prev * 100.0 if prev else None
        return {"symbol": symbol, "last": last, "change_pct_24h": chg}
