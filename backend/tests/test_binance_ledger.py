"""/ledger 的组装：八个端点合并成一条时间线。

Binance 没有统一的流水接口，所以这一组盯的是"合并"本身——每条记录带对出处、
八种不同的响应壳都拆得开、以及三个只有读文档才知道的坑：
提现的 applyTime 是字符串、杠杆利息的字段官方拼错了、闪兑与小额兑换各有各的壳。
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from analyzer.binance.cache import SourceCache
from analyzer.binance.client import BinanceClient
from analyzer.binance.ledger import (
    LIMITED_BY, MAX_WINDOW_DAYS, TRANSFER_TYPES, WINDOWS, build_ledger,
)

from binance_mock import NOW, make_transport


@pytest.fixture
def cache(pool):
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_cache")
    return SourceCache(pool)


def build(cache, *, days=7, fail=None, calls=None, force=True):
    client = BinanceClient("k", "s", client=httpx.Client(
        transport=make_transport(fail=fail, calls=calls, ledger=True)))
    try:
        return build_ledger(client, cache, days=days, force=force, now=NOW)
    finally:
        client.close()


def kinds(snap):
    out = {}
    for e in snap["entries"]:
        out.setdefault(e["kind"], []).append(e)
    return out


# --- 形状与窗口 -----------------------------------------------------------

def test_snapshot_shape_and_sources(cache):
    snap = build(cache)
    assert set(snap) == {"as_of", "sources", "windows", "window", "entries"}
    assert {s["key"] for s in snap["sources"]} == {
        "deposits", "withdrawals", "income", "wallet_transfers", "earn_rewards",
        "margin_interest", "convert", "dust"}
    assert all(s["status"] == "ok" for s in snap["sources"])


def test_window_is_capped_by_the_tightest_source(cache):
    """能查多久由最紧的那个端点决定，不是想查多久就查多久。"""
    assert MAX_WINDOW_DAYS == 30 and LIMITED_BY == "earn_rewards"
    snap = build(cache, days=90)          # 要 90 天
    assert snap["window"]["days"] == 30   # 只能给 30
    assert snap["window"]["max_days"] == 30
    assert snap["window"]["limited_by"] == "earn_rewards"


def test_windows_table_is_exposed_for_the_ui(cache):
    """"为什么只能看 30 天"和"刷一次多贵"都由这张表回答，它是内容不是脚注。"""
    snap = build(cache)
    rows = {w["key"]: w for w in snap["windows"]}
    assert rows["withdrawals"]["weight"] == 18000
    assert rows["convert"]["fanout"] == "起止时间都必填"
    assert rows["wallet_transfers"]["calls"] == len(TRANSFER_TYPES)
    total = sum(w["weight"] * w["calls"] for w in WINDOWS)
    assert total > 20_000        # IP 限额 6000/分钟，界面上要说出这个代价


# --- 三个读文档才知道的坑 --------------------------------------------------

def test_withdraw_apply_time_is_a_string_not_a_timestamp(cache):
    """当成毫秒解析会得到 1970 年，整段提现排到时间线最底下、日期还全错。"""
    entry = kinds(build(cache))["withdraw"][0]
    assert entry["time"] is not None
    assert datetime.fromisoformat(entry["time"]).year == NOW.year
    assert entry["amount"] == -2000.0      # 提现记负


def test_margin_interest_field_is_misspelled_upstream(cache):
    """官方把它拼成 interestAccuredTime（少个 c）。照着写才取得到。"""
    entry = kinds(build(cache))["margin_interest"][0]
    assert entry["time"] is not None
    assert entry["amount"] == pytest.approx(-1.04)   # 利息是成本，记负
    assert entry["wallet"] == "cross_margin"


def test_convert_and_dust_have_different_envelopes(cache):
    """闪兑返回 list，小额兑换返回 userAssetDribblets——三个端点三种壳。"""
    got = kinds(build(cache))
    convert = got["convert"][0]
    assert convert["asset"] == "BNB" and convert["amount"] == pytest.approx(1.465)
    assert convert["from_asset"] == "USDT" and convert["from_amount"] == -1000.0
    assert convert["from_value_usd"] == pytest.approx(-1000.0)
    assert len(got["convert"]) == 1        # FAILED 那笔不算

    dust = got["dust"][0]
    assert dust["asset"] == "BNB" and dust["from_asset"] == "2 种小额资产"
    # 换出去那侧是多个币种，没有单一数量可填——留 null，不编一个
    assert dust["from_amount"] is None and dust["from_value_usd"] is None


# --- 分类与符号 -----------------------------------------------------------

def test_every_entry_carries_its_source(cache):
    """合并出来的流水，出处必须跟着走——否则没法回答"这条是哪来的"。"""
    snap = build(cache)
    assert snap["entries"]
    for entry in snap["entries"]:
        assert entry["source"] in {s["key"] for s in snap["sources"]}
        assert entry["group"] in {"external", "income", "internal"}


def test_transfers_are_net_neutral_and_carry_both_wallets(cache):
    """划转是一条"从哪搬到哪"的记录，不是两条腿；它不改变净值。"""
    entry = kinds(build(cache))["transfer"][0]
    assert entry["amount"] == 800.0        # 正数：记"搬了多少"
    assert entry["wallet"] == "spot" and entry["counterparty"] == "usdm_futures"
    assert entry["group"] == "internal"


def test_income_transfer_rows_never_become_ledger_income(cache):
    """TRANSFER 混进收支，净值仍然对得上、盈亏全错——最难发现的一类。"""
    got = kinds(build(cache))
    assert {e["kind"] for e in got["funding_fee"]} == {"funding_fee"}
    assert "transfer" in got
    income_ids = {e["id"] for e in got["funding_fee"] + got["realized_pnl"]}
    assert "income:7003" not in income_ids     # 那条 TRANSFER 的 tranId
    assert all(e["group"] == "income" for e in got["realized_pnl"])


def test_pending_deposit_is_excluded(cache):
    got = kinds(build(cache))
    assert len(got["deposit"]) == 1
    assert got["deposit"][0]["amount"] == 3000.0


def test_entries_are_sorted_newest_first(cache):
    times = [e["time"] for e in build(cache)["entries"] if e["time"]]
    assert times == sorted(times, reverse=True)


def test_earn_rewards_cover_both_flexible_and_locked(cache):
    assets = {e["asset"] for e in kinds(build(cache))["earn_reward"]}
    assert assets == {"USDT", "BNB"}       # 活期一条、定期一条


# --- 降级 -----------------------------------------------------------------

def test_fapi_451_removes_only_the_income_rows(cache):
    snap = build(cache, fail={"/fapi": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["income"]["status"] == "unreachable"
    assert states["deposits"]["status"] == "ok"
    got = kinds(snap)
    assert "funding_fee" not in got and "realized_pnl" not in got
    assert got["deposit"] and got["transfer"]


def test_one_transfer_type_failing_marks_the_whole_class_incomplete(cache):
    """12 次调用里只要有一次没问到，这一类就是不完整的——不能报"正常"。"""
    snap = build(cache, fail={"/sapi/v1/asset/transfer": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["wallet_transfers"]["status"] == "unreachable"


def test_expensive_sources_are_not_refetched_on_force(cache):
    """提现权重 18000、闪兑 3000，连点"重新取数"不能把预算打空。"""
    calls: list[str] = []
    build(cache, calls=calls, force=True)
    first = len(calls)
    build(cache, calls=calls, force=True)
    again = [p for p in calls[first:] if not p.endswith("/time")]
    assert "/sapi/v1/capital/withdraw/history" not in again
    assert "/sapi/v1/convert/tradeFlow" not in again
    assert "/sapi/v1/capital/deposit/hisrec" in again    # 便宜的照常强刷


def test_different_windows_are_cached_separately(cache):
    """7 天与 30 天是两次不同的查询，不能互相顶替。"""
    calls: list[str] = []
    build(cache, days=7, calls=calls, force=False)
    first = len(calls)
    build(cache, days=30, calls=calls, force=False)
    assert any(p == "/sapi/v1/capital/deposit/hisrec" for p in calls[first:])


def test_entry_ids_are_unique_even_without_a_natural_key(cache):
    """前端拿 id 当 React key，撞了不会报错，只会渲染错行——那种看着正常的错。"""
    snap = build(cache)
    ids = [e["id"] for e in snap["entries"]]
    assert len(ids) == len(set(ids))


def test_unique_id_pass_handles_real_collisions():
    """同一资产在同一时刻的两条派息就会撞——直接构造出来验去重本身。"""
    from analyzer.binance.ledger import _ensure_unique_ids

    rows = [{"id": "earn_rewards:T:USDT"}, {"id": "earn_rewards:T:USDT"},
            {"id": "income:7001"}, {"id": "earn_rewards:T:USDT"}]
    _ensure_unique_ids(rows)
    ids = [r["id"] for r in rows]
    assert ids == ["earn_rewards:T:USDT", "earn_rewards:T:USDT#1",
                   "income:7001", "earn_rewards:T:USDT#2"]
    assert len(set(ids)) == 4


def test_malformed_response_degrades_one_kind_not_the_page(cache):
    """一类流水的形状变了，只该带走那一类。"""
    base = make_transport(ledger=True)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/sapi/v1/margin/interestHistory":
            return httpx.Response(200, json={"rows": ["not-an-object"]})
        return base.handler(request)

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        snap = build_ledger(client, cache, days=7, force=True, now=NOW)
    finally:
        client.close()

    states = {s["key"]: s for s in snap["sources"]}
    assert states["margin_interest"]["status"] == "unsupported"
    assert "形状意外" in states["margin_interest"]["detail"]
    assert states["deposits"]["status"] == "ok"
    assert kinds(snap)["deposit"]      # 其余照常
