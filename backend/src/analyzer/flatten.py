"""把 pydantic 模型摊平成可入库的行（纯函数，可单测，不联网）。

模型 → 时间序列/催化剂行的**唯一映射处**。新增数据维度 = 在这里加一行映射，
采集器与存储都不用动。
"""

from __future__ import annotations

from .marketstore import GLOBAL, Sample
from .models import CatalystReport, MarketSnapshot


def flatten_snapshot(snap: MarketSnapshot) -> list[Sample]:
    """MarketSnapshot → 全量标量样本（尽量把每个有意义的数值都历史化；None 跳过）。

    技术面逐周期带 _{tf} 后缀；衍生品/情绪/链上把含义明确的数值都摊出来。
    全市场指标(恐惧贪婪/稳定币)记 scope=global、symbol=GLOBAL。
    """
    sym = snap.meta.symbol
    out: list[Sample] = []

    def add(metric: str, value, *, scope: str = "symbol", key: str | None = None):
        if value is not None:
            out.append(Sample(scope, key or sym, metric, float(value)))

    # --- 技术面：每个周期一组 ---
    ref = snap.timeframes.get("1h") or next(iter(snap.timeframes.values()), None)
    if ref is not None:
        add("price", ref.last_price)
    for tf, v in snap.timeframes.items():
        add(f"change_pct_{tf}", v.change_pct)
        add(f"rsi_{tf}", v.momentum.rsi)
        add(f"macd_hist_{tf}", v.momentum.macd_hist)
        add(f"atr_{tf}", v.volatility.atr)
        add(f"atr_pct_{tf}", v.volatility.atr_percentile)
        add(f"vol_ratio_{tf}", v.volume.vs_avg20)
        add(f"bb_upper_{tf}", v.key_levels.bb_upper)
        add(f"bb_lower_{tf}", v.key_levels.bb_lower)

    # --- 盘口微观结构 ---
    mb = snap.microstructure
    if mb is not None:
        add("spread_bps", mb.spread_bps)
        add("ob_imbalance", mb.imbalance)
        add("ob_bid_depth_usd", mb.bid_depth_usd)
        add("ob_ask_depth_usd", mb.ask_depth_usd)

    # --- 衍生品（含分位/子项）---
    d = snap.derivatives
    if d is not None:
        if d.funding_rate:
            add("funding_rate", d.funding_rate.value)
            add("funding_annualized", d.funding_rate.annualized_pct)
            add("funding_percentile", d.funding_rate.percentile)
        if d.open_interest:
            add("open_interest_usd", d.open_interest.value_usd)
            add("oi_change_24h", d.open_interest.change_24h_pct)
        if d.long_short_ratio:
            add("lsr", d.long_short_ratio.value)
            add("lsr_percentile", d.long_short_ratio.percentile)
        if d.top_trader_lsr:
            add("top_trader_lsr", d.top_trader_lsr.value)
            add("top_trader_percentile", d.top_trader_lsr.percentile)
        if d.taker_volume:
            add("taker_buy_sell_ratio", d.taker_volume.value)
            add("taker_percentile", d.taker_volume.percentile)
        if d.basis:
            add("basis_perp", d.basis.perp_vs_spot_pct)
            add("basis_quarterly", d.basis.quarterly_annualized_pct)
        if d.options:
            add("dvol", d.options.dvol)
            add("atm_iv", d.options.atm_iv)
            add("put_call_ratio", d.options.put_call_oi_ratio)
            add("iv_skew", d.options.iv_skew_pct)
            add("max_pain", d.options.max_pain)
            add("options_total_oi", d.options.total_oi_contracts)
        if d.liquidations:
            add("liq_long_24h", d.liquidations.long_usd_24h)
            add("liq_short_24h", d.liquidations.short_usd_24h)
            add("liq_total_24h", d.liquidations.total_usd_24h)

    # --- 情绪与注意力 ---
    s = snap.sentiment
    if s is not None:
        if s.fear_greed:
            add("fear_greed", s.fear_greed.value, scope="global", key=GLOBAL)
        if s.social:
            add("galaxy_score", s.social.galaxy_score)
            add("social_dominance", s.social.social_dominance)
            add("social_sentiment", s.social.sentiment)

    # --- 链上（含变化率）---
    o = snap.onchain
    if o is not None:
        if o.stablecoins:
            add("stablecoin_total", o.stablecoins.total_usd, scope="global", key=GLOBAL)
            add("stablecoin_change_7d", o.stablecoins.change_7d_pct, scope="global", key=GLOBAL)
            add("stablecoin_change_30d", o.stablecoins.change_30d_pct, scope="global", key=GLOBAL)
        if o.chain_tvl:
            add("chain_tvl", o.chain_tvl.tvl_usd)
            add("chain_tvl_change_30d", o.chain_tvl.change_30d_pct)
        if o.network:
            add("active_addresses", o.network.active_addresses)
            add("tx_count", o.network.tx_count)
            add("fees_usd", o.network.fees_usd)

    return out


def flatten_catalysts(report: CatalystReport, symbol: str) -> list[tuple[str, str, list[dict]]]:
    """CatalystReport → [(kind, symbol_scope, items)]，供 store.replace_catalysts 分组写入。

    symbol：该币的入库 key（用规范符号，如 BTC/USDT）；宏观用 GLOBAL。
    """
    groups: list[tuple[str, str, list[dict]]] = []

    tu = report.token_unlocks
    if tu and tu.next_event:
        e = tu.next_event
        title = f"{e.tokens:,.0f} {tu.protocol} 解锁"
        if e.pct_of_max_supply is not None:
            title += f"（占供给 {e.pct_of_max_supply}%）"
        groups.append(
            ("unlock", symbol, [{"event_date": e.date, "title": title, "payload": tu.model_dump()}])
        )

    if report.macro_calendar:
        items = [
            {"event_date": m.date, "title": f"{m.name}", "payload": m.model_dump()}
            for m in report.macro_calendar
        ]
        groups.append(("macro", GLOBAL, items))

    if report.news:
        items = [
            {
                "event_date": n.published_at,
                "title": n.title,
                "payload": n.model_dump(),  # 存完整新闻（摘要/情绪/标的/分类/配图/来源）
            }
            for n in report.news
        ]
        groups.append(("news", symbol, items))

    return groups
