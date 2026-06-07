from analyzer.config import IndicatorThresholds
from analyzer.indicators.compute import TFIndicators
from analyzer.snapshot.builder import build_derivatives, build_timeframe_view

TH = IndicatorThresholds()


def base_ind(**over) -> TFIndicators:
    d = dict(
        last_price=100.0,
        change_pct=1.0,
        ema20=95.0,
        ema50=90.0,
        ema200=80.0,
        rsi=50.0,
        macd_line=1.0,
        macd_signal=0.5,
        macd_hist=0.5,
        macd_hist_prev=-0.1,
        bb_upper=110.0,
        bb_mid=100.0,
        bb_lower=90.0,
        bb_width=0.2,
        bb_width_prev=0.15,
        atr=5.0,
        atr_percentile=0.6,
        volume=150.0,
        volume_avg20=100.0,
        recent_swing_high=120.0,
        recent_swing_low=80.0,
    )
    d.update(over)
    return TFIndicators(**d)


def test_overbought_golden_cross_bullish():
    v = build_timeframe_view(base_ind(rsi=75.0), TH)
    assert v.momentum.rsi_state == "overbought"
    assert v.momentum.macd_state == "golden_cross_forming"
    assert v.trend.ema_alignment == "bullish"  # 100 > 95 > 90
    assert v.trend.price_vs_ema200 == "above"
    assert v.volume.state == "above_average"  # 150/100 = 1.5


def test_oversold_and_bb_above_upper():
    v = build_timeframe_view(base_ind(rsi=20.0, last_price=115.0), TH)
    assert v.momentum.rsi_state == "oversold"
    assert v.volatility.bb_position == "above_upper"


def test_bearish_alignment():
    v = build_timeframe_view(base_ind(last_price=70.0), TH)
    assert v.trend.ema_alignment == "mixed"  # 70 < ema20=95 但 ema20>ema50，非空头排列
    assert v.trend.price_vs_ema200 == "below"


def test_derivatives_labels():
    d = build_derivatives(
        {"value": 0.0006, "percentile": 0.92},  # 历史高位 → 多头拥挤付费
        {"value_usd": 1e10, "change_24h_pct": 8.0},
        {"value": 2.5, "percentile": 0.9},  # 历史高位 → 拥挤多头
        -1.8,  # 价格在跌
        TH,
    )
    assert d.funding_rate.state == "high_long_pays"
    assert d.funding_rate.percentile == 0.92
    assert d.open_interest.state == "rising"
    assert d.oi_price_divergence == "price_down_oi_up"
    assert d.long_short_ratio.bias == "long"  # 2.5 > 1
    assert d.long_short_ratio.vs_history == "elevated"  # 分位 0.9 高


def test_derivatives_low_percentile():
    d = build_derivatives(
        {"value": -0.0002, "percentile": 0.05},
        None,
        {"value": 0.8, "percentile": 0.1},
        2.0,
        TH,
    )
    assert d.funding_rate.state == "low_short_pays"
    assert d.long_short_ratio.bias == "short"  # 0.8 < 0.95
    assert d.long_short_ratio.vs_history == "depressed"  # 分位 0.1 低
    assert d.open_interest is None


def test_derivatives_missing_percentile_is_neutral():
    d = build_derivatives({"value": 0.0006}, None, {"value": 1.8}, 1.0, TH)
    assert d.funding_rate.state == "neutral"  # 无历史分位 → 不妄判
    assert d.long_short_ratio.bias == "long"  # 1.8 > 1
    assert d.long_short_ratio.vs_history == "unknown"  # 无分位


def test_derivatives_all_none():
    assert build_derivatives(None, None, None, None, TH) is None


def test_basis_uses_quarterly_when_present():
    d = build_derivatives(
        None, None, None, None, TH,
        basis={"perp_vs_spot_pct": 0.01, "quarterly_annualized_pct": 6.5, "quarterly_expiry": "2026-06-26"},
    )
    assert d.basis.state == "contango"  # 年化基差 6.5 >= 2.0
    assert d.basis.quarterly_expiry == "2026-06-26"


def test_basis_backwardation_falls_back_to_perp():
    d = build_derivatives(
        None, None, None, None, TH,
        basis={"perp_vs_spot_pct": -0.08, "quarterly_annualized_pct": None},
    )
    assert d.basis.state == "backwardation"  # 无季度 → 看永续溢价 -0.08 <= -0.03


def test_top_trader_lsr_independent_of_global():
    d = build_derivatives(
        None, None,
        {"value": 2.5, "percentile": 0.9},  # 散户偏多、分位高
        None, TH,
        top_trader={"value": 0.7, "percentile": 0.1},  # 大户偏空、分位低 → 背离
    )
    assert d.long_short_ratio.bias == "long" and d.long_short_ratio.vs_history == "elevated"
    assert d.top_trader_lsr.bias == "short" and d.top_trader_lsr.vs_history == "depressed"


def test_oi_divergence_deadband_flat():
    # OI 仅 -0.09%，在死区(1%)内 → oi_flat，不报方向背离
    d = build_derivatives(None, {"value_usd": 1e9, "change_24h_pct": -0.09}, None, 2.0, TH)
    assert d.oi_price_divergence == "price_up_oi_flat"


def test_options_summary_states():
    d = build_derivatives(
        None, None, None, None, TH,
        options={
            "underlying_price": 60000.0,
            "put_call_oi_ratio": 1.4,  # >=1.2 defensive
            "iv_skew_pct": 3.5,  # >=2.0 put_skew
            "dvol": 48.0,
            "atm_iv": 50.0,
            "max_pain": 60000.0,
            "nearest_expiry": "27JUN26",
            "total_oi_contracts": 123456.0,
            "top_oi_strikes": [{"strike": 65000.0, "oi": 999.0}],
        },
    )
    assert d.options.pcr_state == "defensive"
    assert d.options.iv_skew_state == "put_skew"
    assert d.options.max_pain == 60000.0


def test_liquidations_dominant_side():
    d = build_derivatives(
        None, None, None, None, TH,
        liquidations={
            "long_usd_24h": 8_000_000.0,
            "short_usd_24h": 1_000_000.0,
            "total_usd_24h": 9_000_000.0,
            "dominant_side": "long",
            "recent_spike": True,
        },
    )
    assert d.liquidations.dominant_side == "long"
    assert d.liquidations.recent_spike is True
