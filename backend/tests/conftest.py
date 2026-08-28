"""共享测试夹具：PG 连接池 + 隔离的存储夹具 + 最小合法 MarketSnapshot。

测试库默认 dbname=fanisl_test（本地 socket）；可用 FANISL_TEST_CONNINFO 覆盖。
每个用例前 TRUNCATE 相关表做隔离（pytest 默认串行执行）。
"""

import os

# **测试永不读 .env 里的真实连接串。** analyzer.runtime 在模块级就开三个池，而
# test_keyframe_api 这类只想要一个纯函数的用例会因为 import analyzer.main 把它带进来。
# 2026-08-19 撞过：本机 .env 的知识库指向服务器隧道，隧道一断，整个测试会话在**收集阶段**
# 就 PoolTimeout 失败，报错还落在一个声明"不碰真库"的文件上。
#
# 注意不能用环境变量覆盖：config.settings_customise_sources 有意把 dotenv 排在 env 之前
# （防止 shell 里残留的 ANTHROPIC_* 劫持项目配置），所以 .env 会压过 os.environ。
# 它留的测试入口是 init_settings——直接构造 Settings(...) 传参，那一路优先级最高。
# 这段必须在任何 analyzer 子模块被导入之前执行：runtime 里的 `from .config import
# get_settings` 是在它自己被导入那一刻绑定的，晚于此处。
import analyzer.config as _cfg  # noqa: E402

_TEST_DB = os.environ.get("FANISL_TEST_CONNINFO", "dbname=fanisl_test")
_test_settings = _cfg.Settings(pg_conninfo=_TEST_DB, pg_trading_conninfo=_TEST_DB,
                               pg_knowledge_conninfo=_TEST_DB)
_cfg.get_settings = lambda: _test_settings

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


# timescaledb 只有 metric_samples 那张 hypertable 需要，37 个测试文件里仅 4 个碰得到。
# 开发机上装它要加 tap、搬扩展库、改 shared_preload_libraries——为 4 个文件不值当。
# 缺了就跳过那 4 个，其余照跑。
HAS_TIMESCALE = False


def _bootstrap_conninfo() -> str:
    """确保测试库存在（timescaledb 有则启用，无则降级），返回 conninfo。"""
    global HAS_TIMESCALE
    if "FANISL_TEST_CONNINFO" in os.environ:
        conninfo = os.environ["FANISL_TEST_CONNINFO"]
    else:
        with psycopg.connect("dbname=postgres", autocommit=True) as c:
            exists = c.execute(
                "SELECT 1 FROM pg_database WHERE datname='fanisl_test'"
            ).fetchone()
            if not exists:
                c.execute("CREATE DATABASE fanisl_test")
        conninfo = "dbname=fanisl_test"
    with psycopg.connect(conninfo, autocommit=True) as c:
        try:
            c.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
            HAS_TIMESCALE = True
        except psycopg.errors.Error:
            HAS_TIMESCALE = False
    return conninfo


@pytest.fixture(scope="session")
def pool():
    p = make_pool(_bootstrap_conninfo())
    yield p
    p.close()


@pytest.fixture
def store(pool):
    """隔离的 MarketStore：建表后清空时间序列/催化剂/日志。

    需要 timescaledb（metric_samples 是 hypertable）。装了才跑，没装就跳过——
    别让一个只影响 4 个文件的可选依赖挡住整个测试会话。
    """
    if not HAS_TIMESCALE:
        pytest.skip("本机无 timescaledb 扩展；metric_samples 需要它。"
                    "装法：brew tap timescale/tap && brew install timescaledb")
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
            "position_snapshots, trade_events, trade_results, trade_reviews, declines, "
            "setup_signals, event_annotations RESTART IDENTITY CASCADE"
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
