"""把 raw 指标数值 + 阈值 翻译成"语义快照"。无 IO、纯函数。

这是"数字 → 人话"的唯一地方。Claude 读语义标签做判断，同时拿到真实数字可引用、可审计。
"""

from __future__ import annotations

from ..config import IndicatorThresholds
from ..indicators.compute import TFIndicators
from ..models import (
    Basis,
    Derivatives,
    FearGreed,
    FundingRate,
    ChainTVL,
    KeyLevels,
    Liquidations,
    LongShortRatio,
    MomentumView,
    NetworkActivity,
    OnChain,
    OpenInterest,
    OrderBook,
    OptionsSummary,
    Sentiment,
    SocialMetrics,
    StablecoinSupply,
    TakerVolume,
    TimeframeView,
    TrendView,
    VolatilityView,
    VolumeView,
)


def build_timeframe_view(ind: TFIndicators, th: IndicatorThresholds) -> TimeframeView:
    return TimeframeView(
        last_price=round(ind.last_price, 4),
        change_pct=round(ind.change_pct, 2),
        as_of=ind.as_of or None,
        trend=_trend(ind),
        momentum=_momentum(ind, th),
        volatility=_volatility(ind),
        volume=_volume(ind, th),
        key_levels=KeyLevels(
            recent_swing_high=round(ind.recent_swing_high, 4),
            recent_swing_low=round(ind.recent_swing_low, 4),
            bb_upper=round(ind.bb_upper, 4),
            bb_lower=round(ind.bb_lower, 4),
        ),
    )


def _trend(ind: TFIndicators) -> TrendView:
    price = ind.last_price
    if price > ind.ema20 and ind.ema20 > ind.ema50:
        alignment = "bullish"
        short = "短期多头"
    elif price < ind.ema20 and ind.ema20 < ind.ema50:
        alignment = "bearish"
        short = "短期空头/回调"
    else:
        alignment = "mixed"
        short = "短期均线纠缠"

    above200 = price > ind.ema200
    mid = "中期偏多" if above200 else "中期偏空"
    return TrendView(
        ema_alignment=alignment,
        price_vs_ema200="above" if above200 else "below",
        label=f"{mid}、{short}",
    )


def _momentum(ind: TFIndicators, th: IndicatorThresholds) -> MomentumView:
    if ind.rsi >= th.rsi_overbought:
        rsi_state = "overbought"
    elif ind.rsi <= th.rsi_oversold:
        rsi_state = "oversold"
    else:
        rsi_state = "neutral"

    hist, prev = ind.macd_hist, ind.macd_hist_prev
    if hist > 0 and prev <= 0:
        macd_state = "golden_cross_forming"
    elif hist < 0 and prev >= 0:
        macd_state = "death_cross_forming"
    elif hist > 0:
        macd_state = "bull"
    else:
        macd_state = "bear"

    return MomentumView(
        rsi=round(ind.rsi, 1),
        rsi_state=rsi_state,
        macd_hist=round(ind.macd_hist, 4),
        macd_state=macd_state,
    )


def _volatility(ind: TFIndicators) -> VolatilityView:
    price = ind.last_price
    if price > ind.bb_upper:
        bb_position = "above_upper"
    elif price > ind.bb_mid:
        bb_position = "upper_half"
    elif price > ind.bb_lower:
        bb_position = "lower_half"
    else:
        bb_position = "below_lower"

    if ind.bb_width > ind.bb_width_prev * 1.02:
        width_state = "expanding"
    elif ind.bb_width < ind.bb_width_prev * 0.98:
        width_state = "contracting"
    else:
        width_state = "stable"

    return VolatilityView(
        atr=round(ind.atr, 4),
        atr_percentile=round(ind.atr_percentile, 2),
        bb_position=bb_position,
        bb_width_state=width_state,
    )


def _volume(ind: TFIndicators, th: IndicatorThresholds) -> VolumeView:
    ratio = ind.volume / ind.volume_avg20 if ind.volume_avg20 else 1.0
    if ratio >= th.volume_high_ratio:
        state = "above_average"
    elif ratio <= th.volume_low_ratio:
        state = "below_average"
    else:
        state = "normal"
    return VolumeView(vs_avg20=round(ratio, 2), state=state)


def build_derivatives(
    funding: dict | None,
    oi: dict | None,
    lsr: dict | None,
    price_change_pct: float | None,
    th: IndicatorThresholds,
    *,
    top_trader: dict | None = None,
    taker: dict | None = None,
    basis: dict | None = None,
    options: dict | None = None,
    liquidations: dict | None = None,
) -> Derivatives | None:
    funding_view = _funding(funding, th)
    oi_view = _open_interest(oi, th)
    lsr_view = _long_short(lsr, th)
    top_view = _long_short(top_trader, th)
    taker_view = _taker(taker, th)
    basis_view = _basis(basis, th)
    options_view = _options(options, th)
    liq_view = _liquidations(liquidations)
    divergence = _divergence(price_change_pct, oi, th.oi_divergence_deadband_pct)

    if not any(
        [funding_view, oi_view, lsr_view, top_view, taker_view, basis_view,
         options_view, liq_view, divergence]
    ):
        return None
    return Derivatives(
        funding_rate=funding_view,
        open_interest=oi_view,
        oi_price_divergence=divergence,
        long_short_ratio=lsr_view,
        top_trader_lsr=top_view,
        taker_volume=taker_view,
        basis=basis_view,
        options=options_view,
        liquidations=liq_view,
    )


def _basis(basis: dict | None, th: IndicatorThresholds) -> Basis | None:
    if not basis or basis.get("perp_vs_spot_pct") is None:
        return None
    perp = float(basis["perp_vs_spot_pct"])
    annual = basis.get("quarterly_annualized_pct")
    if annual is not None:  # 有季度合约：用年化基差判定（信息量更高）
        if annual >= th.basis_contango_annual_pct:
            state = "contango"
        elif annual <= -th.basis_contango_annual_pct:
            state = "backwardation"
        else:
            state = "flat"
    elif perp >= th.basis_perp_premium_pct:
        state = "contango"
    elif perp <= -th.basis_perp_premium_pct:
        state = "backwardation"
    else:
        state = "flat"
    return Basis(
        perp_vs_spot_pct=perp,
        quarterly_annualized_pct=annual,
        quarterly_expiry=basis.get("quarterly_expiry"),
        state=state,
    )


def _options(options: dict | None, th: IndicatorThresholds) -> OptionsSummary | None:
    if not options or options.get("put_call_oi_ratio") is None:
        return None
    pcr = float(options["put_call_oi_ratio"])
    if pcr >= th.pcr_high:
        pcr_state = "defensive"  # 看跌堆积，防御/对冲情绪
    elif pcr <= th.pcr_low:
        pcr_state = "offensive"  # 看涨堆积，进攻情绪
    else:
        pcr_state = "neutral"

    skew = options.get("iv_skew_pct")
    if skew is None:
        skew_state = "neutral"
    elif skew >= th.iv_skew_pct:
        skew_state = "put_skew"  # 下行保护更贵，恐慌定价
    elif skew <= -th.iv_skew_pct:
        skew_state = "call_skew"  # 上行更贵，追涨定价
    else:
        skew_state = "neutral"

    return OptionsSummary(
        underlying_price=options["underlying_price"],
        dvol=options.get("dvol"),
        atm_iv=options.get("atm_iv"),
        put_call_oi_ratio=pcr,
        pcr_state=pcr_state,
        iv_skew_pct=skew,
        iv_skew_state=skew_state,
        max_pain=options.get("max_pain"),
        nearest_expiry=options["nearest_expiry"],
        total_oi_contracts=options["total_oi_contracts"],
        top_oi_strikes=options.get("top_oi_strikes", []),
    )


def build_sentiment(fg: dict | None, social: dict | None) -> Sentiment | None:
    """情绪与注意力块：市场恐惧贪婪 + 该币社交热度。两者都拿不到则返回 None。"""
    fg_view = FearGreed.model_validate(fg) if fg else None
    social_view = SocialMetrics.model_validate(social) if social else None
    if not fg_view and not social_view:
        return None
    return Sentiment(fear_greed=fg_view, social=social_view)


def build_onchain(
    stablecoins: dict | None, chain_tvl: dict | None, network: dict | None
) -> OnChain | None:
    """链上块：全市场稳定币 + 该链 TVL + 网络使用度。全空则返回 None。"""
    sc = StablecoinSupply.model_validate(stablecoins) if stablecoins else None
    tvl = ChainTVL.model_validate(chain_tvl) if chain_tvl else None
    net = NetworkActivity.model_validate(network) if network else None
    if not any([sc, tvl, net]):
        return None
    return OnChain(stablecoins=sc, chain_tvl=tvl, network=net)


def _liquidations(liq: dict | None) -> Liquidations | None:
    if not liq or liq.get("total_usd_24h") is None:
        return None
    return Liquidations(
        long_usd_24h=liq["long_usd_24h"],
        short_usd_24h=liq["short_usd_24h"],
        total_usd_24h=liq["total_usd_24h"],
        dominant_side=liq["dominant_side"],
        recent_spike=liq.get("recent_spike", False),
    )


def _funding(funding: dict | None, th: IndicatorThresholds) -> FundingRate | None:
    if not funding or funding.get("value") is None:
        return None
    v = float(funding["value"])
    pct = funding.get("percentile")
    if pct is None:  # 没历史分位时退回按符号判断
        state = "low_short_pays" if v < 0 else "neutral"
    elif pct >= th.funding_high_pct:
        state = "high_long_pays"  # 处于历史高位，多头拥挤付费
    elif pct <= th.funding_low_pct:
        state = "low_short_pays"  # 历史低位/为负，空头付费、偏空情绪
    else:
        state = "neutral"
    annualized = round(v * 3 * 365 * 100, 2)  # 一天结算 3 次（8h）
    return FundingRate(
        value=v,
        annualized_pct=annualized,
        percentile=round(pct, 2) if pct is not None else None,
        state=state,
    )


def _open_interest(oi: dict | None, th: IndicatorThresholds) -> OpenInterest | None:
    if not oi:
        return None
    change = oi.get("change_24h_pct")
    if change is None:
        state = "unknown"
    elif change >= th.oi_change_significant_pct:
        state = "rising"
    elif change <= -th.oi_change_significant_pct:
        state = "falling"
    else:
        state = "flat"
    return OpenInterest(
        value_usd=oi.get("value_usd"),
        change_24h_pct=round(change, 2) if change is not None else None,
        state=state,
    )


def _long_short(lsr: dict | None, th: IndicatorThresholds) -> LongShortRatio | None:
    if not lsr or lsr.get("value") is None:
        return None
    v = float(lsr["value"])
    # 绝对方向：账户净偏多/偏空（value>1 偏多）
    bias = "long" if v >= 1.05 else "short" if v <= 0.95 else "neutral"
    # 相对自身历史：高/低分位（depressed ≠ 空头拥挤，只是"比平时更不偏多"）
    pct = lsr.get("percentile")
    if pct is None:
        vs_history = "unknown"
    elif pct >= th.lsr_crowded_pct:
        vs_history = "elevated"
    elif pct <= 1 - th.lsr_crowded_pct:
        vs_history = "depressed"
    else:
        vs_history = "normal"
    return LongShortRatio(
        value=round(v, 2),
        bias=bias,
        percentile=round(pct, 2) if pct is not None else None,
        vs_history=vs_history,
    )


def build_order_book(ob: dict | None) -> OrderBook | None:
    if not ob or ob.get("mid") is None:
        return None
    imb = float(ob.get("imbalance") or 0.0)
    pressure = "bid_heavy" if imb >= 0.15 else "ask_heavy" if imb <= -0.15 else "balanced"
    return OrderBook(
        mid=round(float(ob["mid"]), 4),
        spread_bps=float(ob.get("spread_bps") or 0.0),
        bid_depth_usd=float(ob.get("bid_depth_usd") or 0.0),
        ask_depth_usd=float(ob.get("ask_depth_usd") or 0.0),
        imbalance=imb,
        pressure=pressure,
    )


def _taker(taker: dict | None, th: IndicatorThresholds) -> TakerVolume | None:
    if not taker or taker.get("value") is None:
        return None
    v = float(taker["value"])
    bias = "buy" if v >= 1.05 else "sell" if v <= 0.95 else "neutral"
    pct = taker.get("percentile")
    if pct is None:
        vs_history = "unknown"
    elif pct >= th.lsr_crowded_pct:
        vs_history = "elevated"
    elif pct <= 1 - th.lsr_crowded_pct:
        vs_history = "depressed"
    else:
        vs_history = "normal"
    return TakerVolume(
        value=round(v, 4),
        bias=bias,
        percentile=round(pct, 2) if pct is not None else None,
        vs_history=vs_history,
    )


def _divergence(
    price_change_pct: float | None, oi: dict | None, deadband_pct: float = 1.0
) -> str | None:
    if price_change_pct is None or not oi or oi.get("change_24h_pct") is None:
        return None
    oc = oi["change_24h_pct"]
    price_dir = "up" if price_change_pct > 0 else "down"
    # OI 变化在死区内视为持平，不报方向背离（避免把 -0.09% 这类噪声当信号）
    if abs(oc) < deadband_pct:
        oi_dir = "flat"
    else:
        oi_dir = "up" if oc > 0 else "down"
    return f"price_{price_dir}_oi_{oi_dir}"
