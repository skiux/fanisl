"""共享测试夹具：PG 连接池 + 隔离的存储夹具 + 最小合法 MarketSnapshot。

测试库默认 dbname=fanisl_test（本地 socket）；可用 FANISL_TEST_CONNINFO 覆盖。
每个用例前 TRUNCATE 相关表做隔离（pytest 默认串行执行）。
"""

import os

import psycopg
import pytest

from analyzer.db import make_pool
from analyzer.marketstore import MarketStore
from analyzer.storage import Storage
from analyzer.trading.store import TradingStore
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


def _bootstrap_conninfo() -> str:
    """确保测试库 + timescaledb 扩展存在，返回 conninfo。"""
    if "FANISL_TEST_CONNINFO" in os.environ:
        return os.environ["FANISL_TEST_CONNINFO"]
    with psycopg.connect("dbname=postgres", autocommit=True) as c:
        exists = c.execute(
            "SELECT 1 FROM pg_database WHERE datname='fanisl_test'"
        ).fetchone()
        if not exists:
            c.execute("CREATE DATABASE fanisl_test")
    with psycopg.connect("dbname=fanisl_test", autocommit=True) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    return "dbname=fanisl_test"


@pytest.fixture(scope="session")
def pool():
    p = make_pool(_bootstrap_conninfo())
    yield p
    p.close()


@pytest.fixture
def store(pool):
    """隔离的 MarketStore：建表后清空时间序列/催化剂/日志。"""
    st = MarketStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE metric_samples, catalyst_items, collection_runs RESTART IDENTITY"
        )
    return st


@pytest.fixture
def conv_store(pool):
    """隔离的 Storage：建表后清空对话/消息。"""
    s = Storage(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE conversations, messages RESTART IDENTITY CASCADE")
    return s


@pytest.fixture
def trading_store(pool):
    """隔离的 TradingStore（复用 fanisl_test 库，交易表与行情表不冲突）。"""
    st = TradingStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE accounts, trades, trade_plans, decision_inputs, orders, "
            "position_snapshots, trade_events, trade_results, trade_reviews, declines "
            "RESTART IDENTITY CASCADE"
        )
    return st


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
