"""事件与催化剂的可插拔 provider（Part 2）。

和行情数据源(MarketDataSource)、加密情绪(CryptoSentiment)并列的第三类源：
偏「值得推理、而非计算」的维度——解锁、宏观、币圈事件、新闻、ETF 流向。
每个 provider 都可选；factory 按 key 是否配置决定挂哪些，get_catalysts 工具里 best-effort 调用。

新增一个催化剂源 = 实现对应 Provider + 在 factory.build_catalysts 里挂上。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class UnlockProvider(ABC):
    name: str

    @abstractmethod
    def fetch_unlocks(self, symbol: str) -> dict | None:
        """某币的代币解锁/归属日程；非归属代币或失败返回 None。"""


class MacroCalendarProvider(ABC):
    name: str

    @abstractmethod
    def fetch_calendar(self, days: int = 14) -> list[dict] | None:
        """未来 days 天的宏观经济事件（FOMC/CPI/利率等）。"""


class CryptoEventsProvider(ABC):
    name: str

    @abstractmethod
    def fetch_events(self, symbol: str | None = None, days: int = 14) -> list[dict] | None:
        """币圈事件（上所/主网/升级/解锁等）；symbol=None 取大盘事件。"""


class NewsProvider(ABC):
    name: str

    @abstractmethod
    def fetch_news(self, symbol: str | None = None) -> list[dict] | None:
        """最新新闻标题；symbol=None 取大盘新闻。"""


class EtfFlowProvider(ABC):
    name: str

    @abstractmethod
    def fetch_etf_flows(self, asset: str) -> dict | None:
        """BTC/ETH 现货 ETF 资金流。"""


@dataclass
class Catalysts:
    """催化剂源集合，都是可选的。缺谁就少一块，不影响其余。"""

    unlocks: UnlockProvider | None = None
    macro: MacroCalendarProvider | None = None
    events: CryptoEventsProvider | None = None
    news: NewsProvider | None = None
    etf_flows: EtfFlowProvider | None = None
