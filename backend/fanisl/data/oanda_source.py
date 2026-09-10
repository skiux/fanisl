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

    def fetch_ohlcv_history(
        self, symbol: str, timeframe: str, since_iso: str, *, sleep_s: float = 1.5,
    ) -> list[dict]:
        """分页深回填：from+count 游标推进到当下，返回升序 [{ts_close, close}]。

        - OANDA candle time = bar **开盘**时刻；研究入库须打**收盘**戳（值已知的时刻，
          B-1 教训），这里直接返回 ts_close = time + 周期。
        - 只收 complete=true 的 bar（forming bar 值会变，不落库）。
        - 游标无法前进（重复窗口/空返回）即停，防死循环。
        """
        import time as _time
        from datetime import timedelta as _td

        gran = _GRAN.get(timeframe)
        if gran is None:
            raise DataSourceError(f"OANDA 不支持周期 {timeframe}")
        step = {"1h": _td(hours=1), "4h": _td(hours=4), "1d": _td(days=1)}.get(timeframe)
        if step is None:
            raise DataSourceError(f"fetch_ohlcv_history 未支持周期 {timeframe}")
        out: list[dict] = []
        cursor = since_iso
        prev_last_open = None
        while True:
            # 长分页里瞬时网络错误（SSL 握手超时等）不该废掉整次回填：每页最多重试 3 次
            for attempt in range(4):
                try:
                    data = self._get(
                        f"/v3/instruments/{symbol}/candles",
                        {"granularity": gran, "count": 5000, "price": "M", "from": cursor},
                    )
                    break
                except DataSourceError:
                    if attempt == 3:
                        raise
                    _time.sleep(5.0 * (attempt + 1))
            candles = [c for c in data.get("candles", []) if c.get("complete")]
            if not candles:
                break   # 空页（到当下，forming bar 已被过滤）
            last_open = pd.to_datetime(candles[-1]["time"], utc=True).to_pydatetime()
            # 短页不早停（ccxt 分页教训），只在空页/游标不再前进时停
            if prev_last_open is not None and last_open <= prev_last_open:
                break
            for c in candles:
                t_open = pd.to_datetime(c["time"], utc=True).to_pydatetime()
                out.append({"ts_close": (t_open + step).isoformat(),
                            "close": float(c["mid"]["c"])})
            prev_last_open = last_open
            # from 是包含式：游标推到最后一根之后
            cursor = (last_open + _td(seconds=1)).isoformat()
            _time.sleep(sleep_s)
        return out

    def fetch_window(
        self, symbol: str, timeframe: str, from_iso: str, to_iso: str,
    ) -> list[dict]:
        """取一个时间窗内的 bar（单页 ≤5000，事件研究窗口用）。
        返回升序 [{ts_close, close}]，只收 complete bar，ts=收盘戳。"""
        gran = _GRAN.get(timeframe, timeframe if timeframe.startswith(("M", "S", "H")) else None)
        if gran is None:
            raise DataSourceError(f"OANDA 不支持周期 {timeframe}")
        step = {"M1": pd.Timedelta(minutes=1), "M5": pd.Timedelta(minutes=5),
                "H1": pd.Timedelta(hours=1)}.get(gran)
        if step is None:
            raise DataSourceError(f"fetch_window 未支持粒度 {gran}")
        data = self._get(
            f"/v3/instruments/{symbol}/candles",
            {"granularity": gran, "price": "M", "from": from_iso, "to": to_iso},
        )
        out = []
        for c in data.get("candles", []):
            if not c.get("complete"):
                continue
            t_open = pd.to_datetime(c["time"], utc=True)
            out.append({"ts_close": (t_open + step).isoformat(), "close": float(c["mid"]["c"])})
        return out

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
