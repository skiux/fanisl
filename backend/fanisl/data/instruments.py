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
    provider: str  # 'okx'(实为 binance) | 'polygon' | 'oanda' —— 分析数据源
    provider_symbol: str  # 该源的符号
    asset_class: str  # stock | index | etf | metal | commodity | crypto
    default_timeframes: list[str]
    # 执行用的 Binance 永续符号（TradFi 历史短/闭市flatline，分析走 Polygon/OANDA，
    # 但下单/盯市/止损止盈统一以 Binance 永续为准）。None=就地在分析源执行（加密）。
    exec_symbol: str | None = None


_INSTRUMENTS: dict[str, Instrument] = {}


def _reg(aliases: list[str], inst: Instrument) -> None:
    for a in aliases:
        _INSTRUMENTS[a.upper()] = inst


# 美股 / 指数 / ETF / 原油 → Polygon 分析；能在 Binance 交易的带 exec_symbol(永续)。
_reg(["NDX", "^NDX", "NAS100", "IXIC"], Instrument("NDX", "polygon", "I:NDX", "index", _EOD_TF))
_reg(["QQQ"], Instrument("QQQ", "polygon", "QQQ", "etf", _EOD_TF, exec_symbol="QQQ/USDT:USDT"))
_reg(["SPY"], Instrument("SPY", "polygon", "SPY", "etf", _EOD_TF, exec_symbol="SPY/USDT:USDT"))
_reg(["NVDA"], Instrument("NVDA", "polygon", "NVDA", "stock", _EOD_TF, exec_symbol="NVDA/USDT:USDT"))
_reg(["AAPL"], Instrument("AAPL", "polygon", "AAPL", "stock", _EOD_TF, exec_symbol="AAPL/USDT:USDT"))
_reg(["TSLA"], Instrument("TSLA", "polygon", "TSLA", "stock", _EOD_TF, exec_symbol="TSLA/USDT:USDT"))
_reg(["MSFT"], Instrument("MSFT", "polygon", "MSFT", "stock", _EOD_TF, exec_symbol="MSFT/USDT:USDT"))
_reg(["META"], Instrument("META", "polygon", "META", "stock", _EOD_TF, exec_symbol="META/USDT:USDT"))
_reg(["AMZN"], Instrument("AMZN", "polygon", "AMZN", "stock", _EOD_TF, exec_symbol="AMZN/USDT:USDT"))
_reg(["GOOGL", "GOOG"], Instrument("GOOGL", "polygon", "GOOGL", "stock", _EOD_TF, exec_symbol="GOOGL/USDT:USDT"))
_reg(["COIN"], Instrument("COIN", "polygon", "COIN", "stock", _EOD_TF, exec_symbol="COIN/USDT:USDT"))
_reg(["MSTR"], Instrument("MSTR", "polygon", "MSTR", "stock", _EOD_TF, exec_symbol="MSTR/USDT:USDT"))
_reg(["MU"], Instrument("MU", "polygon", "MU", "stock", _EOD_TF, exec_symbol="MU/USDT:USDT"))
_reg(["CRCL"], Instrument("CRCL", "polygon", "CRCL", "stock", _EOD_TF, exec_symbol="CRCL/USDT:USDT"))
_reg(["SNDK"], Instrument("SNDK", "polygon", "SNDK", "stock", _EOD_TF, exec_symbol="SNDK/USDT:USDT"))
_reg(["CL", "CL1!", "WTI", "OIL", "USOIL", "CRUDE"], Instrument("CL", "polygon", "CL1!", "commodity", _EOD_TF, exec_symbol="CL/USDT:USDT"))
# 金属 → OANDA 分析；金银可在 Binance 永续交易
_reg(["XAU", "XAUUSD", "XAU/USD", "GOLD"], Instrument("XAU/USD", "oanda", "XAU_USD", "metal", _INTRADAY_TF, exec_symbol="XAU/USDT:USDT"))
_reg(["XAG", "XAGUSD", "XAG/USD", "SILVER"], Instrument("XAG/USD", "oanda", "XAG_USD", "metal", _INTRADAY_TF, exec_symbol="XAG/USDT:USDT"))
# 无外部行情源（Polygon 无 Brent / Pre-IPO 无公开市场）→ 分析与执行都用 Binance 永续。
# provider="okx" 即加密源(实为 Binance)，provider_symbol 直接给永续合约符号。
_reg(["BZ", "BRENT"], Instrument("BZ", "okx", "BZ/USDT:USDT", "commodity", _INTRADAY_TF))
_reg(["SPCX", "SPACEX"], Instrument("SPCX", "okx", "SPCX/USDT:USDT", "preipo", _INTRADAY_TF))


def lookup(symbol: str) -> Instrument | None:
    return _INSTRUMENTS.get(symbol.strip().upper())


def registered_symbols() -> list[str]:
    """给提示词/工具描述用：canonical(asset_class) 列表，去重。"""
    seen: dict[str, str] = {}
    for inst in _INSTRUMENTS.values():
        seen[inst.canonical] = inst.asset_class
    return [f"{c}({a})" for c, a in seen.items()]


def tradeable_canonicals() -> list[str]:
    """已登记的可交易标的(canonical)去重列表——自主扫描的非加密标的来源。"""
    return list({inst.canonical: None for inst in _INSTRUMENTS.values()})


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
    source: MarketDataSource  # 分析数据源（快照/指标）
    provider_symbol: str
    canonical: str
    asset_class: str
    default_timeframes: list[str]
    supports_derivatives: bool
    exec_source: MarketDataSource  # 执行源（下单/盯市/止损止盈的 mark price）
    exec_symbol: str  # 执行源上的符号


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
                exec_symbol=inst.exec_symbol,
            )
        # 默认：当作加密交易对，走 default_provider
        pair = normalize_pair(symbol)
        return self._resolved(self._default, pair, pair, "crypto", _INTRADAY_TF)

    def _resolved(
        self, provider, provider_symbol, canonical, asset_class, tfs, *, exec_symbol=None
    ) -> Resolved:
        src = self._sources.get(provider)
        if src is None:
            raise SymbolNotFound(f"{canonical} 需要的数据源 {provider} 未配置")
        if exec_symbol:
            # 统一在 Binance(default_provider 持有的加密源)执行
            exec_src = self._sources.get(self._default)
            if exec_src is None:
                raise SymbolNotFound(f"{canonical} 的执行源 {self._default} 未配置")
            e_src, e_sym = exec_src, exec_symbol
        else:
            e_src, e_sym = src, provider_symbol  # 加密/无 Binance 映射：就地执行
        return Resolved(
            source=src,
            provider_symbol=provider_symbol,
            canonical=canonical,
            asset_class=asset_class,
            default_timeframes=tfs,
            supports_derivatives=src.supports_derivatives,
            exec_source=e_src,
            exec_symbol=e_sym,
        )
