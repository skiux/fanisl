"""从配置组装所有数据源 → Resolver。

**加/换数据源就改这一个文件**：写好 Source 类后，在下面 sources 字典里加一项，
再去 instruments.py 用同名 provider 登记标的即可。其余代码（agent/tool/main）不用动。
"""

from __future__ import annotations

from ..config import Settings
from .alternativeme_source import AlternativeMeSource
from .blockchaininfo_source import BlockchainInfoSource
from .catalysts import Catalysts
from .ccxt_source import CCXTSource
from .coinalyze_source import CoinalyzeSource
from .cryptocompare_source import CryptoCompareNewsSource
from .defillama_source import DefiLlamaOnChain, DefiLlamaSource
from .deribit_source import DeribitSource
from .fred_source import FREDSource
from .derivatives import CryptoSentiment
from .instruments import Resolver
from .oanda_source import OANDASource
from .polygon_source import PolygonSource


def build_resolver(settings: Settings) -> Resolver:
    sources = {
        "okx": CCXTSource(settings.exchange),  # 加密永续（含衍生品）
        "polygon": PolygonSource(settings.polygon_api_key),  # 美股/指数/ETF/原油
        "oanda": OANDASource(settings.oanda_api_token, settings.oanda_practice),  # 金属
    }
    return Resolver(sources, default_provider="okx")


def build_crypto_sentiment(settings: Settings) -> CryptoSentiment:
    """加密快照的额外信号源（多数无需 key）：
    期权(Deribit)、爆仓(Coinalyze 需 key)、恐惧贪婪(Alternative.me)、
    稳定币/链 TVL(DefiLlama)、BTC 网络(Blockchain.info)。

    社交(LunarCrush)：其 API 2026 起转付费，免费 key 全端点返回 402，故暂不挂；
    待订阅或换 Santiment 再启用（见 data-gaps / data-upgrades）。
    """
    onchain = DefiLlamaOnChain()  # 稳定币 + 链 TVL 同一源
    return CryptoSentiment(
        options=DeribitSource(),
        liquidations=(
            CoinalyzeSource(settings.coinalyze_api_key)
            if settings.coinalyze_api_key
            else None
        ),
        fear_greed=AlternativeMeSource(),
        social=None,  # LunarCrush 付费墙；见上
        stablecoins=onchain,
        chain_tvl=onchain,
        network=BlockchainInfoSource(),
    )


def build_catalysts(settings: Settings) -> Catalysts:
    """事件与催化剂源（Part 2）。代币解锁(DefiLlama)无需 key，自动启用；
    宏观/事件/新闻/ETF 流待接入对应源后在此挂上（多数需免费 key）。"""
    return Catalysts(
        unlocks=DefiLlamaSource(),  # 无需 key
        macro=FREDSource(settings.fred_api_key) if settings.fred_api_key else None,
        news=(
            CryptoCompareNewsSource(settings.cryptocompare_api_key)
            if settings.cryptocompare_api_key
            else None
        ),
        # events=...     # 币圈事件：CoinMarketCal API 转付费、Coindar 需另注册——见 data-gaps
        # etf_flows=...  # 无干净免费源，见 data-gaps（待订阅）
    )
