"""flatten 纯函数单测：模型 → 入库行（不联网）。"""

from analyzer.flatten import flatten_catalysts, flatten_snapshot
from analyzer.models import (
    CatalystReport,
    MacroEvent,
    NewsItem,
    TokenUnlocks,
    UnlockEvent,
)


def test_flatten_snapshot(make_snapshot):
    samples = flatten_snapshot(make_snapshot("BTC/USDT", price=100.0))
    by = {s.metric: s for s in samples}
    assert by["price"].value == 100.0 and by["price"].symbol == "BTC/USDT"
    assert by["rsi_1d"].value == 60.0  # 来自 1d 周期
    assert by["funding_rate"].value == 0.0006
    # 全市场指标记 scope=global / symbol=GLOBAL
    assert by["fear_greed"].scope == "global" and by["fear_greed"].symbol == "GLOBAL"
    assert by["stablecoin_total"].symbol == "GLOBAL"
    # 单币链上
    assert by["chain_tvl"].value == 4.0e9 and by["chain_tvl"].symbol == "BTC/USDT"


def test_flatten_snapshot_skips_none(make_snapshot):
    snap = make_snapshot()
    snap.onchain.chain_tvl = None  # 置空 → 不应产生该样本
    metrics = {s.metric for s in flatten_snapshot(snap)}
    assert "chain_tvl" not in metrics
    assert "price" in metrics


def test_flatten_catalysts_groups_and_scopes():
    rep = CatalystReport(
        symbol="BTC",
        token_unlocks=TokenUnlocks(
            symbol="ARB", protocol="arbitrum",
            next_event=UnlockEvent(date="2026-07-01", tokens=1000.0, pct_of_max_supply=1.0, category="team", type="cliff"),
        ),
        macro_calendar=[MacroEvent(date="2026-06-10", name="CPI", importance="high")],
        news=[NewsItem(published_at="2026-06-07T00:00:00", title="X", source="Y", url="z")],
    )
    groups = {g[0]: g for g in flatten_catalysts(rep, "BTC/USDT")}
    assert groups["unlock"][1] == "BTC/USDT"  # 解锁按币
    assert groups["macro"][1] == "GLOBAL"  # 宏观全市场
    assert groups["news"][1] == "BTC/USDT"
    assert groups["unlock"][2][0]["event_date"] == "2026-07-01"


def test_flatten_catalysts_empty():
    assert flatten_catalysts(CatalystReport(symbol="BTC"), "BTC/USDT") == []
