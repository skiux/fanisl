"""get_market_snapshot 编排：按 symbol 路由到对应数据源，串起 data → indicators → snapshot。

资产类别感知：只有合约市场（加密永续）才取衍生品；股票/金属/原油只出技术面。
逐周期取数算指标；单个周期失败只记 warning、不影响其余。全部周期失败才抛错。
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..config import Settings
from ..data.base import DataSourceError, SymbolNotFound
from ..data.derivatives import CryptoSentiment
from ..data.instruments import Resolver
from ..indicators.compute import compute_indicators
from ..models import MarketSnapshot, SnapshotMeta
from ..snapshot.builder import (
    build_derivatives,
    build_onchain,
    build_order_book,
    build_sentiment,
    build_timeframe_view,
)


def get_market_snapshot(
    symbol: str,
    timeframes: list[str] | None,
    resolver: Resolver,
    settings: Settings,
    sentiment: CryptoSentiment | None = None,
) -> MarketSnapshot:
    r = resolver.resolve(symbol)  # SymbolNotFound 由上层转结构化错误
    tfs = timeframes or r.default_timeframes
    th = settings.thresholds
    warnings: list[str] = []
    views = {}

    for tf in tfs:
        try:
            df = r.source.fetch_ohlcv(r.provider_symbol, tf, settings.ohlcv_limit)
            ind = compute_indicators(df, th.atr_percentile_window)
            views[tf] = build_timeframe_view(ind, th)
        except SymbolNotFound:
            raise
        except (DataSourceError, ValueError) as e:
            warnings.append(f"{tf} 数据不可用: {e}")

    if not views:
        raise DataSourceError(
            f"{r.canonical} 数据不可用: {'; '.join(warnings) or '未知原因'}"
        )

    # 盘口微观结构（分析源支持才有：加密=Binance 有；股票/金属源返回 None）
    microstructure = build_order_book(r.source.fetch_order_book_stats(r.provider_symbol))

    derivatives = None
    if r.supports_derivatives:
        funding = r.source.fetch_funding_rate(r.provider_symbol)
        oi = r.source.fetch_open_interest(r.provider_symbol)
        lsr = r.source.fetch_long_short_ratio(r.provider_symbol)
        top_trader = r.source.fetch_top_trader_lsr(r.provider_symbol)
        taker = r.source.fetch_taker_volume(r.provider_symbol)
        basis = r.source.fetch_basis(r.provider_symbol)

        base = r.canonical.split("/")[0]  # 期权/爆仓按币种 base 取，不绑交易所

        # 期权：只对「有期权市场」的币取、告警（山寨没期权是正常的，不该报不可用）
        options = None
        options_covered = bool(
            sentiment and sentiment.options and sentiment.options.covers(base)
        )
        if options_covered:
            options = sentiment.options.fetch_options_summary(base)

        liquidations = (
            sentiment.liquidations.fetch_liquidations(base)
            if sentiment and sentiment.liquidations
            else None
        )

        checks = [
            ("资金费率", funding),
            ("未平仓量", oi),
            ("多空比", lsr),
            ("大户多空比", top_trader),
            ("主动买卖量比", taker),
            ("基差/期限结构", basis),
            ("爆仓数据", liquidations),
        ]
        if options_covered:
            checks.append(("期权情绪", options))
        for label, val in checks:
            if val is None:
                warnings.append(f"{label}不可用")

        derivatives = build_derivatives(
            funding,
            oi,
            lsr,
            _reference_change(views),
            th,
            top_trader=top_trader,
            taker=taker,
            basis=basis,
            options=options,
            liquidations=liquidations,
        )

    # 情绪与注意力 + 链上（仅加密）。当确认信号用。
    sentiment_view = None
    onchain_view = None
    if r.asset_class == "crypto" and sentiment:
        base = r.canonical.split("/")[0]

        fg = sentiment.fear_greed.fetch_fear_greed() if sentiment.fear_greed else None
        social = sentiment.social.fetch_social(base) if sentiment.social else None
        if sentiment.fear_greed and fg is None:
            warnings.append("市场情绪指数不可用")
        if sentiment.social and social is None:
            warnings.append("社交热度不可用")
        sentiment_view = build_sentiment(fg, social)

        stablecoins = (
            sentiment.stablecoins.fetch_stablecoins() if sentiment.stablecoins else None
        )
        chain_tvl = (
            sentiment.chain_tvl.fetch_chain_tvl(base) if sentiment.chain_tvl else None
        )
        network = sentiment.network.fetch_network(base) if sentiment.network else None
        if sentiment.stablecoins and stablecoins is None:
            warnings.append("稳定币供应不可用")
        # chain_tvl/network 对很多币本就不适用（非 L1 原生/非 BTC），缺失是正常的，不告警
        onchain_view = build_onchain(stablecoins, chain_tvl, network)

    return MarketSnapshot(
        meta=SnapshotMeta(
            symbol=r.canonical,
            exchange=r.source.name,
            asset_class=r.asset_class,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            data_warnings=warnings,
        ),
        timeframes=views,
        microstructure=microstructure,
        derivatives=derivatives,
        sentiment=sentiment_view,
        onchain=onchain_view,
    )


def _reference_change(views: dict) -> float | None:
    for tf in ("1d", "4h", "1h"):
        if tf in views:
            return views[tf].change_pct
    return next(iter(views.values())).change_pct if views else None
