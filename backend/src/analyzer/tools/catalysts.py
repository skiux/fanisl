"""get_catalysts 编排：聚合事件与催化剂维度（解锁/宏观/币圈事件/新闻/ETF流）。

与 get_market_snapshot 分开：催化剂不随价格跳动、很多是全市场维度。每块 best-effort，
某个源缺失/失败只记 warning，不影响其余。providers 由 factory.build_catalysts 组装。
"""

from __future__ import annotations

from ..data.catalysts import Catalysts
from ..models import (
    CatalystReport,
    CryptoEvent,
    EtfFlow,
    MacroEvent,
    NewsItem,
    TokenUnlocks,
)


def get_catalysts(
    symbol: str | None,
    catalysts: Catalysts | None,
) -> CatalystReport:
    warnings: list[str] = []
    base = symbol.split("/")[0].split(":")[0].upper() if symbol else None

    if catalysts is None:
        return CatalystReport(symbol=base, warnings=["催化剂数据源未配置"])

    token_unlocks = None
    if not catalysts.unlocks:
        warnings.append("解锁数据未接入")
    elif not base:
        pass  # 无 symbol 不查解锁
    else:
        raw = catalysts.unlocks.fetch_unlocks(base)
        if raw is None:
            warnings.append(f"{base} 无解锁数据（可能非归属代币或未收录）")
        else:
            token_unlocks = TokenUnlocks.model_validate(raw)

    macro = _collect(
        catalysts.macro, lambda p: p.fetch_calendar(), MacroEvent, "宏观日历", warnings
    )
    events = _collect(
        catalysts.events, lambda p: p.fetch_events(base), CryptoEvent, "币圈事件", warnings
    )
    news = _collect(
        catalysts.news, lambda p: p.fetch_news(base), NewsItem, "新闻", warnings
    )

    etf_flows = None
    if base in ("BTC", "ETH"):
        if not catalysts.etf_flows:
            warnings.append("ETF 资金流未接入")
        else:
            raw = catalysts.etf_flows.fetch_etf_flows(base)
            if raw is None:
                warnings.append("ETF 资金流不可用")
            else:
                etf_flows = EtfFlow.model_validate(raw)

    return CatalystReport(
        symbol=base,
        token_unlocks=token_unlocks,
        macro_calendar=macro,
        crypto_events=events,
        news=news,
        etf_flows=etf_flows,
        warnings=warnings,
    )


def _collect(provider, fetch, model, label: str, warnings: list[str]) -> list:
    """跑一个返回 list[dict] 的 provider，转成 model 列表。

    未接入 → 「X未接入」warning；接入但空/失败 → 「X暂无数据」warning。
    """
    if provider is None:
        warnings.append(f"{label}未接入")
        return []
    rows = fetch(provider)
    if not rows:
        warnings.append(f"{label}暂无数据")
        return []
    return [model.model_validate(r) for r in rows]
