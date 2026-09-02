"""/orders 的组装：三种形状的挂单响应 → 契约里同一个 Order。

最要紧的一条：**合约要读 origType 而不是 type**。条件单触发之后 type 会变成 MARKET，
只看它的话，一张止盈市价单在成交那一刻会显示成"市价单"，下单时的意图就丢了。
样本里那条 TAKE_PROFIT_MARKET 的 type 就是 MARKET，专门盯这个。
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from analyzer.binance.cache import SourceCache
from analyzer.binance.client import BinanceClient
from analyzer.binance.orders import build_orders

from binance_mock import NOW, make_transport


@pytest.fixture
def cache(pool):
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_cache")
    return SourceCache(pool)


def build(cache, *, fail=None, calls=None, symbol=None, venue=None, force=True):
    client = BinanceClient("k", "s", client=httpx.Client(
        transport=make_transport(fail=fail, calls=calls)))
    try:
        return build_orders(client, cache, symbol=symbol, venue=venue,
                            force=force, now=NOW)
    finally:
        client.close()


def by_id(snap):
    return {o["id"]: o for o in snap["open"]}


# --- 形状 -----------------------------------------------------------------

def test_snapshot_shape_and_sources(cache):
    snap = build(cache)
    assert set(snap) == {"as_of", "sources", "open", "order_lists", "history_symbols",
                         "query", "history", "fills"}
    assert {s["key"] for s in snap["sources"]} == {
        "spot_open", "futures_open", "margin_open", "order_lists", "algo_open",
        "order_history", "trade_history"}
    assert all(s["status"] == "ok" for s in snap["sources"])


def test_all_three_venues_land_in_one_list(cache):
    snap = build(cache)
    venues = {o["venue"] for o in snap["open"]}
    assert venues == {"spot", "usdm", "margin"}
    assert len(snap["open"]) == 4 + 3 + 1 + 1     # 现货4 合约3 杠杆1 策略单1


# --- 最容易读错的几处 ------------------------------------------------------

def test_futures_uses_orig_type_not_type(cache):
    """触发后 type 变 MARKET，origType 才是下单意图。"""
    order = by_id(build(cache))["usdm:5200001"]
    assert order["kind"] == "take_profit_market"     # 不是 "market"
    assert order["close_position"] is True
    assert order["stop_price"] == 260.0
    assert order["trigger_by"] == "mark"             # workingType=MARK_PRICE


def test_spot_stop_loss_variants_are_not_swapped(cache):
    """STOP_LOSS 是止损**市价**，STOP_LOSS_LIMIT 才是止损限价。名字很容易读反。"""
    orders = by_id(build(cache))
    assert orders["spot:4100004"]["kind"] == "stop_market"   # STOP_LOSS
    assert orders["spot:4100003"]["kind"] == "stop"          # STOP_LOSS_LIMIT
    assert orders["spot:4100002"]["kind"] == "limit_maker"


def test_market_order_price_zero_becomes_null(cache):
    """市价单的 price 字段是 "0"，那不是"价格为零"。"""
    order = by_id(build(cache))["usdm:5200002"]
    assert order["price"] is None
    assert order["stop_price"] == 190.0


def test_order_list_id_minus_one_becomes_null(cache):
    """现货用 -1 表示"不属于任何 OCO 组"，照搬会变成一个假的组号。"""
    orders = by_id(build(cache))
    assert orders["spot:4100001"]["order_list_id"] is None
    assert orders["spot:4100002"]["order_list_id"] == "77"
    assert orders["spot:4100003"]["order_list_id"] == "77"


def test_notional_counts_only_the_unfilled_part(cache):
    """已经成交的那部分不再占用任何东西。"""
    order = by_id(build(cache))["spot:4100001"]
    assert order["orig_qty"] == 2.0 and order["executed_qty"] == 0.5
    assert order["notional_usd"] == pytest.approx((2.0 - 0.5) * 640.0)


def test_reference_price_prefers_mark_for_futures(cache):
    """条件单按标记价触发，"距触发"就该拿标记价比，不是最新成交价。"""
    order = by_id(build(cache))["usdm:5200001"]
    assert order["reference_price"] == 218.42       # positionRisk 的 markPrice


def test_trailing_stop_carries_activation_and_callback(cache):
    order = by_id(build(cache))["usdm:5200003"]
    assert order["kind"] == "trailing_stop_market"
    assert order["activate_price"] == 640.0
    assert order["callback_rate"] == pytest.approx(0.018)
    assert order["reduce_only"] is True


def test_oco_group_is_reported(cache):
    snap = build(cache)
    assert len(snap["order_lists"]) == 1
    group = snap["order_lists"][0]
    assert group["contingency"] == "OCO" and group["status"] == "executing"
    assert set(group["order_ids"]) == {"spot:4100002", "spot:4100003"}


def test_algo_orders_are_not_silently_dropped(cache):
    """策略单多数账户是空的，但空与"没查"是两回事。"""
    order = by_id(build(cache))["usdm:algo-880001"]
    assert order["kind"] == "twap"
    assert order["orig_qty"] == 10 and order["executed_qty"] == 2


# --- 历史：接口逼出来的形状 ------------------------------------------------

def test_history_symbols_come_from_orders_positions_and_balances(cache):
    """Binance 没有"我交易过哪些对"的接口，只能从三处推候选。"""
    snap = build(cache)
    assert "NVDAUSDT" in snap["history_symbols"]     # 有持仓
    assert "QQQUSDT" in snap["history_symbols"]      # 有挂单
    assert "BNBUSDT" in snap["history_symbols"]      # 现货有余额且存在该交易对


def test_history_window_follows_the_venue_limit(cache):
    """合约单次 < 7 天、回溯 90 天；现货单次 ≤ 24 小时。"""
    fut = build(cache, symbol="NVDAUSDT")["query"]
    assert fut["venue"] == "usdm"
    assert fut["max_window_hours"] == 168 and fut["lookback_days"] == 90
    span = datetime.fromisoformat(fut["to"]) - datetime.fromisoformat(fut["from"])
    assert span == timedelta(hours=168)

    spot = build(cache, symbol="BNBUSDT")["query"]
    assert spot["venue"] == "spot"
    assert spot["max_window_hours"] == 24 and spot["lookback_days"] is None


def test_venue_is_inferred_from_where_the_symbol_lives(cache):
    assert build(cache, symbol="NVDAUSDT")["query"]["venue"] == "usdm"
    assert build(cache, symbol="BNBUSDT")["query"]["venue"] == "spot"
    # 显式指定优先于推断
    assert build(cache, symbol="BNBUSDT", venue="usdm")["query"]["venue"] == "usdm"


def test_futures_history_and_fills(cache):
    snap = build(cache, symbol="NVDAUSDT")
    assert [o["status"] for o in snap["history"]] == ["canceled", "filled"]  # 时间倒序
    fills = {f["id"]: f for f in snap["fills"]}
    sell = fills["usdm:t820002"]
    assert sell["side"] == "sell" and sell["is_maker"] is True
    assert sell["realized_pnl"] == pytest.approx(62.0)


def test_spot_fills_use_is_buyer_and_have_no_realized_pnl(cache):
    """现货成交不结算盈亏，字段本身就没有——不能填 0 冒充。"""
    snap = build(cache, symbol="BNBUSDT")
    fill = snap["fills"][0]
    assert fill["side"] == "buy"                 # 由 isBuyer 推出
    assert fill["realized_pnl"] is None
    assert fill["commission_asset"] == "BNB"


# --- 降级 -----------------------------------------------------------------

def test_fapi_451_keeps_spot_orders_visible(cache):
    snap = build(cache, fail={"/fapi": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["futures_open"]["status"] == "unreachable"
    assert states["spot_open"]["status"] == "ok"
    assert not [o for o in snap["open"]
                if o["venue"] == "usdm" and not o["id"].startswith("usdm:algo-")]
    assert [o for o in snap["open"] if o["venue"] == "spot"]


def test_algo_orders_survive_fapi_451_because_they_live_on_sapi(cache):
    """策略单端点是 /sapi/v1/algo/futures/openOrders——在 api.binance.com 上，不在 fapi。

    所以 451 只打 fapi 时，普通合约挂单没了、策略单还在。这**不是矛盾**，是两个域名。
    前端的"按账户"面板据此不能只看 futures_open 就把 U 本位整行标成"取不到"——
    得 futures_open 与 algo_open 都挂了才算。
    """
    snap = build(cache, fail={"/fapi": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["futures_open"]["status"] == "unreachable"
    assert states["algo_open"]["status"] == "ok"
    algo = [o for o in snap["open"] if o["id"].startswith("usdm:algo-")]
    assert len(algo) == 1 and algo[0]["venue"] == "usdm"


def test_history_failure_is_reported_per_source(cache):
    snap = build(cache, symbol="NVDAUSDT", fail={"/fapi/v1/allOrders": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["order_history"]["status"] == "unreachable"
    assert states["trade_history"]["status"] == "ok"    # 成交那条是另一个端点
    assert snap["history"] == [] and snap["fills"]


def test_no_symbols_means_no_query_not_a_fake_one(cache):
    """一个交易对都推不出来时，query 留空——不要编一个默认交易对出来。"""
    snap = build(cache, fail={"/api/v3/openOrders": 451, "/fapi": 451,
                              "/sapi/v1/margin/openOrders": 451,
                              "/sapi/v1/algo": 451,
                              "/sapi/v3/asset/getUserAsset": 451})
    assert snap["history_symbols"] == []
    assert snap["query"] is None
    assert snap["history"] == [] and snap["fills"] == []


def test_malformed_response_degrades_one_group_not_the_page(cache):
    """一组挂单的形状变了，只该带走那一组。"""
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/fapi/v1/openOrders":
            return httpx.Response(200, json=["not-an-object"])
        return base.handler(request)

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        snap = build_orders(client, cache, force=True, now=NOW)
    finally:
        client.close()

    states = {s["key"]: s for s in snap["sources"]}
    assert states["futures_open"]["status"] == "unsupported"
    assert "形状意外" in states["futures_open"]["detail"]
    assert states["spot_open"]["status"] == "ok"
    assert [o for o in snap["open"] if o["venue"] == "spot"]
