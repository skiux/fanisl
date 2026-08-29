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

from datetime import datetime, timezone

import psycopg
import pytest

from analyzer.db import make_pool
from analyzer.knowledge.models import KnowledgeUnit
from analyzer.knowledge.nodes import NodeStore
from analyzer.knowledge.store import KnowledgeStore
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


# --- 知识引擎的固定语料（标的相关的读模型与接口共用）--------------------------
#
#   内容1 / 信源甲：claim(NVDA，含未到期阶梯) · concept(仅 nvda 标签) · method(nvda+soxx)
#                   · claim(asset_symbol 写成别名 "XAU/USD")
#   内容2 / 信源乙：claim(NVDA，判错) · claim(NVDA，条件未触发) · concept(nvda) · concept(soxx)
#
# 覆盖三件容易错的事：①只认 asset_symbol 会漏掉 method/concept；②别名拼法要归一；
# ③条件类判定不进命中率分母。

PAST_LADDER = "2026-06-30"        # 已判定的阶梯日
FUTURE_LADDER = "2099-06-30"      # 未到期的阶梯日（钉在远期，测试不会随时间腐化）
FUTURE_LADDER_2 = "2099-12-31"    # 同一条 claim 的第二个未到期时点——用来区分"条数"与"时点数"


def _claim(symbol: str, tags: list[str], ladder: list[str], quote: str) -> KnowledgeUnit:
    return KnowledgeUnit(
        kind="claim", quote=quote, tags=tags,
        payload={
            "asset_text": f"{symbol} 的测试判断", "asset_symbol": symbol, "priceable": True,
            "claim_class": "directional", "direction": "up",
            "horizon": {"type": "by_date", "deadline": ladder[-1]},
            "stance_strength": "explicit", "verifiability": "B",
            "scoring_spec": {"method": "sign", "eval_ladder": ladder,
                             "success_def": "到期收盘高于发布参考价即命中"},
        })


def _concept(tags: list[str], quote: str) -> KnowledgeUnit:
    return KnowledgeUnit(kind="concept", quote=quote, tags=tags,
                         payload={"canonical_statement": quote, "category": "market_structure"})


def _method(tags: list[str], quote: str) -> KnowledgeUnit:
    return KnowledgeUnit(kind="method", quote=quote, tags=tags,
                         payload={"name": "测试方法", "summary": quote, "family": "trend",
                                  "rules": ["站上 20 日线买入"], "testability": "A"})


@pytest.fixture
def knowledge_corpus(pool):
    store = KnowledgeStore(pool)
    nodes = NodeStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
            "claim_scores, spot_checks, keyframes, knowledge_nodes, node_attestations, "
            "node_relations RESTART IDENTITY CASCADE")

    a = store.ensure_creator("测试信源甲")
    b = store.ensure_creator("测试信源乙")
    c1, _ = store.upsert_content(a, platform="manual", url="https://example.test/asset-1",
                                 content_type="article", title="内容一",
                                 published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
                                 raw="标的测试语料一")
    c2, _ = store.upsert_content(b, platform="manual", url="https://example.test/asset-2",
                                 content_type="article", title="内容二",
                                 published_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
                                 raw="标的测试语料二")

    u1, u2, u3, u4 = store.record_extraction(c1, extractor_version="asset-v1", model="test", units=[
        _claim("NVDA", ["nvda", "ai-capex"], [PAST_LADDER, FUTURE_LADDER, FUTURE_LADDER_2],
               "英伟达还有空间"),
        _concept(["nvda"], "算力需求的存量与增量要分开看"),
        _method(["nvda", "soxx"], "半导体板块用周线隧道定方向"),
        _claim("XAU/USD", ["xauusd"], [PAST_LADDER], "黄金短期偏强"),
    ])
    u5, u6, u7, u8 = store.record_extraction(c2, extractor_version="asset-v1", model="test", units=[
        _claim("NVDA", ["nvda"], [PAST_LADDER], "英伟达要回调"),
        _claim("NVDA", ["nvda"], ["2026-06-15"], "若跌破 150 则继续看空"),
        _concept(["nvda"], "算力定价终局是按结果收费"),
        _concept(["soxx"], "半导体的周期性并未消失"),
    ])

    ts = datetime(2026, 6, 30, tzinfo=timezone.utc)
    store.record_score(u1, eval_ts=ts, horizon_label=PAST_LADDER, outcome="hit",
                       realized={"ref": 100.0, "eval_close": 110.0}, scorer_version="test-v1")
    store.record_score(u4, eval_ts=ts, horizon_label=PAST_LADDER, outcome="miss",
                       realized={"ref": 4000.0, "eval_close": 3900.0}, scorer_version="test-v1")
    store.record_score(u5, eval_ts=ts, horizon_label=PAST_LADDER, outcome="miss",
                       realized={"ref": 100.0, "eval_close": 110.0}, scorer_version="test-v1")
    store.record_score(u6, eval_ts=datetime(2026, 6, 15, tzinfo=timezone.utc),
                       horizon_label="2026-06-15", outcome="condition_not_met",
                       realized={}, scorer_version="test-v1")

    n_nvda = nodes.import_nodes({"merger_version": "test-merge", "nodes": [{
        "kind": "concept", "title": "算力定价", "canonical": "算力定价终局是按结果收费",
        "tags": ["nvda"], "notes": "演进：存量增量 → 按结果收费",
        "units": [{"id": u2, "relation": "restates"},
                  {"id": u7, "relation": "supersedes", "note": "作者改口"}]}]})[0]
    n_soxx = nodes.import_nodes({"merger_version": "test-merge", "nodes": [{
        "kind": "concept", "title": "半导体周期", "canonical": "半导体的周期性并未消失",
        "tags": ["soxx"], "units": [{"id": u8, "relation": "restates"}]}]})[0]
    nodes.import_relations({"merger_version": "test-merge", "relations": [
        {"a": n_nvda, "b": n_soxx, "relation": "conflicts", "note": "定价范式 vs 周期回归"}]})

    return {"creator_a": a, "creator_b": b, "units": (u1, u2, u3, u4, u5, u6, u7, u8),
            "nodes": (n_nvda, n_soxx)}
