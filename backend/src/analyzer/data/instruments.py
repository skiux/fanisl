"""标的登记表 + 按 symbol 路由到数据源的 Resolver。

非加密标的（美股/指数/ETF/金属/原油）在登记表里写死映射；其余按加密交易对默认走 OKX。
Polygon 原生支持 4h（倍数 4×hour），OANDA 有 H4，所以非加密也统一 1h/4h/1d。
"""

from __future__ import annotations

from dataclasses import dataclass

from .base import MarketDataSource, SymbolNotFound

_INTRADAY_TF = ["1h", "4h", "1d"]  # 加密(OKX)、金属(OANDA)：支持日内
_EOD_TF = ["1d", "1wk"]  # 美股/指数/原油(Polygon 免费档)：仅 EOD，日内拿不到


@dataclass(frozen=True)
class Instrument:
    canonical: str  # 展示用规范符号
    provider: str  # 'okx' | 'polygon' | 'oanda'
    provider_symbol: str  # 该源的符号
    asset_class: str  # stock | index | etf | metal | commodity | crypto
    default_timeframes: list[str]


_INSTRUMENTS: dict[str, Instrument] = {}


def _reg(aliases: list[str], inst: Instrument) -> None:
    for a in aliases:
        _INSTRUMENTS[a.upper()] = inst


# 美股 / 指数 / ETF / 原油 → Polygon（NDX 用 I:NDX；CL1! 走期货）
_reg(["NDX", "^NDX", "NAS100", "IXIC"], Instrument("NDX", "polygon", "I:NDX", "index", _EOD_TF))
_reg(["QQQ"], Instrument("QQQ", "polygon", "QQQ", "etf", _EOD_TF))
_reg(["NVDA"], Instrument("NVDA", "polygon", "NVDA", "stock", _EOD_TF))
_reg(["MU"], Instrument("MU", "polygon", "MU", "stock", _EOD_TF))
_reg(["CRCL"], Instrument("CRCL", "polygon", "CRCL", "stock", _EOD_TF))
_reg(["CL", "CL1!", "WTI", "OIL", "USOIL", "CRUDE"], Instrument("CL", "polygon", "CL1!", "commodity", _EOD_TF))
# 金属 → OANDA
_reg(["XAU", "XAUUSD", "XAU/USD", "GOLD"], Instrument("XAU/USD", "oanda", "XAU_USD", "metal", _INTRADAY_TF))
_reg(["XAG", "XAGUSD", "XAG/USD", "SILVER"], Instrument("XAG/USD", "oanda", "XAG_USD", "metal", _INTRADAY_TF))


def lookup(symbol: str) -> Instrument | None:
    return _INSTRUMENTS.get(symbol.strip().upper())


def registered_symbols() -> list[str]:
    """给提示词/工具描述用：canonical(asset_class) 列表，去重。"""
    seen: dict[str, str] = {}
    for inst in _INSTRUMENTS.values():
        seen[inst.canonical] = inst.asset_class
    return [f"{c}({a})" for c, a in seen.items()]


def normalize_pair(symbol: str) -> str:
    """把 'btcusdt' / 'btc-usdt' 规整成 'BTC/USDT'。"""
    s = symbol.strip().upper().replace("-", "/")
    if "/" not in s:
        for quote in ("USDT", "USDC", "USD", "BTC", "ETH"):
            if s.endswith(quote) and len(s) > len(quote):
                return f"{s[: -len(quote)]}/{quote}"
    return s


@dataclass
class Resolved:
    source: MarketDataSource
    provider_symbol: str
    canonical: str
    asset_class: str
    default_timeframes: list[str]
    supports_derivatives: bool


class Resolver:
    """按 symbol 路由到数据源。

    sources 是 provider 名 → 数据源实例 的字典；default_provider 是登记表里没有的
    符号（默认当加密交易对）走哪个源。加新数据源只需：①写 Source 类 ②在 sources 字典
    里加一项 ③用该 provider 名在上面 _reg 登记标的——Resolver 本身不用改。
    """

    def __init__(
        self, sources: dict[str, MarketDataSource], default_provider: str = "okx"
    ) -> None:
        self._sources = sources
        self._default = default_provider

    def resolve(self, symbol: str) -> Resolved:
        inst = lookup(symbol)
        if inst is not None:
            return self._resolved(
                inst.provider,
                inst.provider_symbol,
                inst.canonical,
                inst.asset_class,
                inst.default_timeframes,
            )
        # 默认：当作加密交易对，走 default_provider
        pair = normalize_pair(symbol)
        return self._resolved(self._default, pair, pair, "crypto", _INTRADAY_TF)

    def _resolved(self, provider, provider_symbol, canonical, asset_class, tfs) -> Resolved:
        src = self._sources.get(provider)
        if src is None:
            raise SymbolNotFound(f"{canonical} 需要的数据源 {provider} 未配置")
        return Resolved(
            source=src,
            provider_symbol=provider_symbol,
            canonical=canonical,
            asset_class=asset_class,
            default_timeframes=tfs,
            supports_derivatives=src.supports_derivatives,
        )
