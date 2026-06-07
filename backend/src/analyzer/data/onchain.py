"""链上数据 provider 抽象（Part 4）。

最正交的维度，但免费只够拿子集：稳定币供应、公链 TVL、网络使用度（均免费/无 key）。
交易所流入流出、MVRV/SOPR/成本分布、巨鲸/聪明钱标签多为付费——见 doc/data-gaps.md。

这些都是「快照增强」，挂在 CryptoSentiment bundle 上，由 get_market_snapshot best-effort 调用。
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class StablecoinProvider(ABC):
    name: str

    @abstractmethod
    def fetch_stablecoins(self) -> dict | None:
        """全市场稳定币总供应 + 7d/30d 变化（场内干火药）。"""


class ChainTvlProvider(ABC):
    name: str

    @abstractmethod
    def fetch_chain_tvl(self, base: str) -> dict | None:
        """该币所在公链的 DeFi TVL + 趋势；非 L1 原生币返回 None。"""


class NetworkActivityProvider(ABC):
    name: str

    @abstractmethod
    def fetch_network(self, base: str) -> dict | None:
        """链上网络使用度（活跃地址/交易数/手续费）；不支持的币返回 None。"""
