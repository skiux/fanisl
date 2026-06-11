"""进程间共享的对象装配：api / collector / trader 三个入口都 import 这里。

把原本散在 main.py 的构造集中到这里，使后台 worker 不必 import FastAPI app。
模块级单例：import 即构造（每个进程各建一份自己的连接池/客户端，互不影响）。
"""

from __future__ import annotations

from .agent import Agent
from .config import get_settings
from .data.factory import build_catalysts, build_crypto_sentiment, build_resolver
from .db import make_pool
from .marketstore import MarketStore
from .storage import Storage
from .trading.engine import TradingEngine
from .trading.service import TradingService
from .trading.store import TradingStore
from .trading.trade_agent import TradeAgent

settings = get_settings()

# --- 行情库（行情时间序列 + 对话）---
pool = make_pool(settings.pg_conninfo)
storage = Storage(pool)
market_store = MarketStore(
    pool,
    retention_days=settings.retention_days,
    compress_after_days=settings.compress_after_days,
    runs_keep=settings.runs_keep,
)
resolver = build_resolver(settings)
sentiment = build_crypto_sentiment(settings)
catalysts = build_catalysts(settings)
agent = Agent(settings, resolver, sentiment, catalysts, market_store)

# --- 交易评测台（独立库）---
trading_pool = make_pool(settings.pg_trading_conninfo)
trading_store = TradingStore(trading_pool)


def live_price(symbol: str) -> float:
    """执行/盯市价以执行源(统一 Binance 永续)为准；TradFi 分析走 Polygon/OANDA，
    但下单与止损止盈按 Binance 成交价计。"""
    r = resolver.resolve(symbol)
    return float(r.exec_source.fetch_ticker(r.exec_symbol)["last"])


trade_engine = TradingEngine(
    trading_store, price_fn=live_price,
    taker_fee_bps=settings.trading_taker_fee_bps, slippage_bps=settings.trading_slippage_bps,
    min_rr=settings.trading_min_rr, reeval_band_pct=settings.trading_reeval_band_pct,
    time_stop_hours=settings.trading_time_stop_hours,
    entry_ttl_hours=settings.trading_entry_ttl_hours,
    reeval_cooldown_min=settings.trading_reeval_cooldown_min,
    reeval_grace_min=settings.trading_reeval_grace_min,
)
trade_agent = TradeAgent(settings, resolver, sentiment, catalysts, market_store)
trading_service = TradingService(trading_store, trade_engine, trade_agent, settings=settings)

_account = trading_store.ensure_account(
    "main", initial_balance=settings.trading_initial_balance,
    max_leverage=settings.trading_max_leverage, margin_mode=settings.trading_margin_mode,
    default_risk_pct=settings.trading_default_risk_pct,
)
ACCOUNT_ID = int(_account["id"])
