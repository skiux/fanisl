"""Polygon.io 数据源：美股 / 指数 / ETF / 原油期货。

用 /v2/aggs 聚合接口，原生支持 4h（倍数 4 × hour）。只有 OHLCV，无衍生品。
需要 POLYGON_API_KEY。注意：指数(I:NDX)需 Indices 附加包、期货(CL1!)需 Futures 产品，
基础(股票)档可能取不到 → 返回干净的"数据不可用"，由上层记成缺口。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from ._http import get_json
from .base import DataSourceError, MarketDataSource, ohlcv_df

# our_tf -> (multiplier, timespan, 回看天数)
_TF = {
    "1h": (1, "hour", 200),
    "4h": (4, "hour", 600),
    "1d": (1, "day", 1500),
    "1wk": (1, "week", 4000),
}

# 最新一根最大允许"年龄"（天）。免费档只有 EOD：日内会返回数月前的陈旧数据，
# 这里拦住，绝不把过期数据当成当前盘面。
_MAX_AGE_DAYS = {"1h": 2, "4h": 3, "1d": 5, "1wk": 14}


class PolygonSource(MarketDataSource):
    name = "polygon"
    supports_derivatives = False

    def __init__(self, api_key: str = "") -> None:
        self.api_key = api_key

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        if not self.api_key:
            raise DataSourceError("Polygon API key 未配置（设置 POLYGON_API_KEY）")
        if timeframe not in _TF:
            raise DataSourceError(f"Polygon 不支持周期 {timeframe}")
        mult, span, lookback = _TF[timeframe]
        to = datetime.now(timezone.utc).date()
        frm = to - timedelta(days=lookback)
        url = (
            f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/{mult}/{span}/{frm}/{to}"
        )
        data = get_json(
            "Polygon",
            url,
            params={"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": self.api_key},
            retry_statuses=(429,),  # 免费档 5 次/分
        )
        results = data.get("results")
        if not results:
            raise DataSourceError(
                f"{symbol} {timeframe} 无数据 (status={data.get('status')})"
            )
        df = ohlcv_df(
            [
                {
                    "ts": pd.to_datetime(x["t"], unit="ms", utc=True),
                    "open": x["o"],
                    "high": x["h"],
                    "low": x["l"],
                    "close": x["c"],
                    "volume": x.get("v", 0.0),
                }
                for x in results
            ]
        )

        age_days = (pd.Timestamp.now(tz="UTC") - df["ts"].iloc[-1]).total_seconds() / 86400
        if age_days > _MAX_AGE_DAYS.get(timeframe, 5):
            raise DataSourceError(
                f"{symbol} {timeframe} 数据过期（最新 {df['ts'].iloc[-1].date()}，"
                "免费档可能不含该周期实时数据）"
            )
        return df.tail(limit).reset_index(drop=True)

    def fetch_ticker(self, symbol: str) -> dict:
        df = self.fetch_ohlcv(symbol, "1d", 2)
        last = float(df["close"].iloc[-1])
        prev = float(df["close"].iloc[-2]) if len(df) > 1 else last
        chg = (last - prev) / prev * 100.0 if prev else None
        return {"symbol": symbol, "last": last, "change_pct_24h": chg}
