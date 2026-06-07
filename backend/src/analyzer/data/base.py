"""可插拔行情数据源接口。

只负责"拿原始数据"，不算指标、不做语义判断。
OHLCV 是必需的；衍生品数据 best-effort（拿不到返回 None，由上层标注 data_warnings）。
扩股票/其他交易所 = 新增一个实现同接口的类即可。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd


class DataSourceError(Exception):
    """取数失败（网络、限流、交易所报错等）。"""


class SymbolNotFound(DataSourceError):
    """交易对在该数据源不存在或不支持。"""


OHLCV_COLS = ["ts", "open", "high", "low", "close", "volume"]


def ohlcv_df(rows: list[dict]) -> pd.DataFrame:
    """把 [{ts, open, high, low, close, volume}] 规整成标准 OHLCV DataFrame。

    ts 需是 pandas 可解析的时间（各源自行把原始时间戳转成 Timestamp 再传入）。
    """
    df = pd.DataFrame(rows, columns=OHLCV_COLS)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    for col in OHLCV_COLS[1:]:
        df[col] = df[col].astype(float)
    return df


class MarketDataSource(ABC):
    name: str
    supports_derivatives: bool = False  # 只有合约市场（加密永续）有 funding/OI/多空比

    @abstractmethod
    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        """返回列为 [ts, open, high, low, close, volume] 的 DataFrame（按时间升序）。"""

    # 衍生品默认无（股票/金属/原油用不到）；合约源覆盖它们。
    def fetch_funding_rate(self, symbol: str) -> dict | None:
        return None

    def fetch_open_interest(self, symbol: str) -> dict | None:
        return None

    def fetch_long_short_ratio(self, symbol: str) -> dict | None:
        return None

    def fetch_top_trader_lsr(self, symbol: str) -> dict | None:
        """大户(精英账户)多空账户比——区分聪明钱 vs 全市场散户方向。"""
        return None

    def fetch_basis(self, symbol: str) -> dict | None:
        """基差/期限结构：永续相对现货溢价 + 季度合约年化基差。"""
        return None

    def fetch_ticker(self, symbol: str) -> dict:
        """{'symbol','last','change_pct_24h'}；价格条用。"""
        raise NotImplementedError
