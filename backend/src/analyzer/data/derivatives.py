"""跨标的的加密情绪数据源（按币种 base 取，不绑定某个交易所）。

与 MarketDataSource（按 symbol 路由、负责 OHLCV+该所衍生品）正交：
- 期权来自 Deribit（无论永续在哪个所）。
- 爆仓来自 Coinalyze（聚合 30+ 所）。

所以单独抽一层 provider，由 factory 组装成 CryptoSentiment，在快照工具里 best-effort 调用。
新增这类源 = 实现对应 Provider + 在 factory.build_crypto_sentiment 里挂上。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from .onchain import ChainTvlProvider, NetworkActivityProvider, StablecoinProvider


class OptionsProvider(ABC):
    name: str

    @abstractmethod
    def fetch_options_summary(self, base: str) -> dict | None:
        """base 如 'BTC'/'ETH'；不支持的币种或失败返回 None（best-effort）。"""

    def covers(self, base: str) -> bool:
        """该币是否有期权市场（无则上层不取、不告警——没有期权是正常的）。"""
        return True


class LiquidationProvider(ABC):
    name: str

    @abstractmethod
    def fetch_liquidations(self, base: str) -> dict | None:
        """近 24h 多/空被爆金额（USD），聚合多所；失败返回 None。"""


class FearGreedProvider(ABC):
    name: str

    @abstractmethod
    def fetch_fear_greed(self) -> dict | None:
        """加密市场整体恐惧贪婪指数（全市场，不分币）。"""


class SocialProvider(ABC):
    name: str

    @abstractmethod
    def fetch_social(self, base: str) -> dict | None:
        """单币社交热度/情绪（galaxy_score/social_dominance/sentiment 等）。"""


@dataclass
class CryptoSentiment:
    """加密快照的额外信号源集合（都是可选的，缺谁就少一块，不影响其余）。

    三类：衍生品微观结构(options/liquidations)、情绪与注意力(fear_greed/social)、
    链上数据(stablecoins/chain_tvl/network)。统一在 get_market_snapshot 里 best-effort 调用。
    """

    options: OptionsProvider | None = None
    liquidations: LiquidationProvider | None = None
    fear_greed: FearGreedProvider | None = None
    social: SocialProvider | None = None
    stablecoins: StablecoinProvider | None = None
    chain_tvl: ChainTvlProvider | None = None
    network: NetworkActivityProvider | None = None
