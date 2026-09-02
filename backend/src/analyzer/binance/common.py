"""Binance 响应的解析共用件。

Binance 的数值**一律是字符串**（"0.00000000"），而且缺字段与字段为 "0" 是两回事。
这里的 `dec` 解析不出来就返回 None 而不是 0——契约里 `null` 表示"取不到"，
`0` 表示"确实是零"，两者在界面上的处置完全不同（留空 vs 显示 $0.00）。
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

T = TypeVar("T")

# walletName → 契约里的 WalletKind。未登记的名字（期权、策略交易之类）原样 slug 化，
# 不丢弃——丢掉就等于把那部分钱从总额里抹掉了。
WALLET_KIND = {
    "Spot": "spot",
    "Funding": "funding",
    "Cross Margin": "cross_margin",
    "Isolated Margin": "isolated_margin",
    "USDⓈ-M Futures": "usdm_futures",
    "USDT-Futures": "usdm_futures",
    "COIN-M Futures": "coinm_futures",
    "Earn": "earn",
    "Options": "options",
    "Trading Bots": "trading_bots",
}

# 稳定币按 1 美元计价：它们没有自己的 USDT 交易对（USDTUSDT 不存在），
# 不特判的话账户里最大的一块反而会变成"无报价"。
_USD_PEGGED = {"USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI"}


def dec(value: Any) -> float | None:
    """Binance 的字符串数值 → float。解析不了返回 None，**不返回 0**。"""
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float("inf"), float("-inf")) else None


def dec0(value: Any) -> float:
    """明确要求"缺失即 0"的场合用它——例如把多个余额相加时。"""
    out = dec(value)
    return 0.0 if out is None else out


def ms_to_iso(value: Any) -> str | None:
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def price_map(rows: Any) -> dict[str, float]:
    """/api/v3/ticker/price 的数组 → {symbol: price}。"""
    out: dict[str, float] = {}
    for row in rows or []:
        price = dec(row.get("price"))
        if price is not None:
            out[row["symbol"]] = price
    return out


def usd_price(asset: str, prices: dict[str, float]) -> float | None:
    """一个币的美元单价；找不到报价对返回 None（契约允许，界面显示"无报价"）。"""
    if asset in _USD_PEGGED:
        return 1.0
    for quote in ("USDT", "USDC", "FDUSD", "BUSD"):
        got = prices.get(f"{asset}{quote}")
        if got is not None:
            return got
    # 只有 BTC 计价对的小币：绕一道 BTC
    via_btc = prices.get(f"{asset}BTC")
    btc = prices.get("BTCUSDT")
    if via_btc is not None and btc is not None:
        return via_btc * btc
    return None


def usd_value(asset: str, qty: float | None, prices: dict[str, float]) -> float | None:
    if qty is None:
        return None
    price = usd_price(asset, prices)
    return None if price is None else qty * price


def base_of(symbol: str) -> str:
    """BTCUSDT → BTC。只处理契约里会出现的几种计价。"""
    for quote in ("USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB"):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return symbol[: -len(quote)]
    return symbol


def guard(label: str, fn: Callable[[], T], *, fallback: T | None = None
          ) -> tuple[T | None, str | None]:
    """跑一个装配步骤，失败就降级成"这一块没有"，而不是把整页带走。

    缓存层只兜得住**网络与 HTTP 错误**（BinanceError），而字段解析是在它外面做的。
    Binance 改过字段类型（数组元素从对象变字符串这类），那时整页会 500，
    而设计原则是按来源降级——一个来源坏了，其余照常。

    错误文本会进到该来源的 detail 里，界面上的「取数状态」看得见；同时打到 stderr，
    journalctl 里能查。**不静默吞掉**。
    """
    try:
        return fn(), None
    except Exception as exc:  # noqa: BLE001 — 装配失败只降级这一块
        detail = f"数据形状意外（{type(exc).__name__}: {exc}）"
        print(f"[fanisl] binance 装配失败 {label}: {exc!r}", file=sys.stderr, flush=True)
        return fallback, detail
