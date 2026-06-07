"""共享测试夹具：构造最小但合法的 MarketSnapshot（给 flatten/collector 测试用）。"""

import pytest

from analyzer.models import (
    ChainTVL,
    Derivatives,
    FearGreed,
    FundingRate,
    KeyLevels,
    MarketSnapshot,
    MomentumView,
    OnChain,
    Sentiment,
    SnapshotMeta,
    StablecoinSupply,
    TimeframeView,
    TrendView,
    VolatilityView,
    VolumeView,
)


def _tfview(price: float, rsi: float) -> TimeframeView:
    return TimeframeView(
        last_price=price,
        change_pct=1.0,
        trend=TrendView(ema_alignment="bullish", price_vs_ema200="above", label="x"),
        momentum=MomentumView(rsi=rsi, rsi_state="neutral", macd_hist=0.1, macd_state="bull"),
        volatility=VolatilityView(atr=1.0, atr_percentile=0.5, bb_position="upper_half", bb_width_state="stable"),
        volume=VolumeView(vs_avg20=1.0, state="normal"),
        key_levels=KeyLevels(recent_swing_high=1.0, recent_swing_low=1.0, bb_upper=1.0, bb_lower=1.0),
    )


@pytest.fixture
def make_snapshot():
    def _make(symbol: str = "BTC/USDT", price: float = 100.0) -> MarketSnapshot:
        return MarketSnapshot(
            meta=SnapshotMeta(symbol=symbol, exchange="okx", fetched_at="2026-06-07T00:00:00+00:00"),
            timeframes={"1h": _tfview(price, 50.0), "1d": _tfview(price, 60.0)},
            derivatives=Derivatives(
                funding_rate=FundingRate(value=0.0006, state="neutral")
            ),
            sentiment=Sentiment(
                fear_greed=FearGreed(value=12, label="Extreme Fear", state="extreme_fear")
            ),
            onchain=OnChain(
                stablecoins=StablecoinSupply(total_usd=3.0e11),
                chain_tvl=ChainTVL(chain="Bitcoin", tvl_usd=4.0e9),
            ),
        )

    return _make
