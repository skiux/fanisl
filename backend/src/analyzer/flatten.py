"""把 pydantic 模型摊平成可入库的行（纯函数，可单测，不联网）。

模型 → 时间序列/催化剂行的**唯一映射处**。新增数据维度 = 在这里加一行映射，
采集器与存储都不用动。
"""

from __future__ import annotations

from .marketstore import GLOBAL, Sample
from .models import CatalystReport, MarketSnapshot


def flatten_snapshot(snap: MarketSnapshot) -> list[Sample]:
    """MarketSnapshot → 标量样本列表（None 的字段跳过）。"""
    sym = snap.meta.symbol
    out: list[Sample] = []

    def add(metric: str, value, *, scope: str = "symbol", key: str | None = None):
        if value is not None:
            out.append(Sample(scope, key or sym, metric, float(value)))

    # 技术面（参考周期）
    ref = snap.timeframes.get("1h") or next(iter(snap.timeframes.values()), None)
    if ref is not None:
        add("price", ref.last_price)
    d1 = snap.timeframes.get("1d")
    if d1 is not None:
        add("rsi_1d", d1.momentum.rsi)

    # 衍生品
    d = snap.derivatives
    if d is not None:
        if d.funding_rate:
            add("funding_rate", d.funding_rate.value)
        if d.open_interest:
            add("open_interest_usd", d.open_interest.value_usd)
        if d.long_short_ratio:
            add("lsr", d.long_short_ratio.value)
        if d.top_trader_lsr:
            add("top_trader_lsr", d.top_trader_lsr.value)
        if d.basis:
            add("basis_perp", d.basis.perp_vs_spot_pct)
            add("basis_quarterly", d.basis.quarterly_annualized_pct)
        if d.options:
            add("dvol", d.options.dvol)
            add("atm_iv", d.options.atm_iv)
            add("put_call_ratio", d.options.put_call_oi_ratio)
            add("max_pain", d.options.max_pain)
        if d.liquidations:
            add("liq_long_24h", d.liquidations.long_usd_24h)
            add("liq_short_24h", d.liquidations.short_usd_24h)

    # 情绪与注意力
    s = snap.sentiment
    if s is not None:
        if s.fear_greed:
            add("fear_greed", s.fear_greed.value, scope="global", key=GLOBAL)
        if s.social:
            add("galaxy_score", s.social.galaxy_score)
            add("social_dominance", s.social.social_dominance)
            add("social_sentiment", s.social.sentiment)

    # 链上
    o = snap.onchain
    if o is not None:
        if o.stablecoins:
            add("stablecoin_total", o.stablecoins.total_usd, scope="global", key=GLOBAL)
        if o.chain_tvl:
            add("chain_tvl", o.chain_tvl.tvl_usd)
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
                "payload": {"source": n.source, "url": n.url},
            }
            for n in report.news
        ]
        groups.append(("news", symbol, items))

    return groups
