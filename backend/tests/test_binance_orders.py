"""/orders 的组装：三种形状的挂单响应 → 契约里同一个 Order。

最要紧的一条：**合约要读 origType 而不是 type**。条件单触发之后 type 会变成 MARKET，
只看它的话，一张止盈市价单在成交那一刻会显示成"市价单"，下单时的意图就丢了。
样本里那条 TAKE_PROFIT_MARKET 的 type 就是 MARKET，专门盯这个。
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from fanisl.binance.cache import SourceCache
from fanisl.binance.client import BinanceClient
from fanisl.binance.orders import build_orders

from binance_mock import EQUITY_HISTORY, INCOME, NOW, make_transport


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
                         "history_venues", "query", "history", "fills"}
    assert {s["key"] for s in snap["sources"]} == {
        "spot_open", "futures_open", "margin_open", "order_lists", "algo_open",
        "conditional_open", "equity_market", "equity_open",
        "order_history", "trade_history"}
    assert all(s["status"] == "ok" for s in snap["sources"])


def test_all_three_venues_land_in_one_list(cache):
    snap = build(cache)
    venues = {o["venue"] for o in snap["open"]}
    assert venues == {"spot", "usdm", "margin", "equity"}
    assert len(snap["open"]) == 4 + 3 + 1 + 1 + 2 + 1


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


def test_current_futures_conditional_orders_are_not_silently_dropped(cache):
    """2025-12 起 TP/SL/追踪止损迁到 Algo Service，普通 openOrders 已不完整。"""
    orders = by_id(build(cache))
    take_profit = orders["usdm:algo-990001"]
    assert take_profit["kind"] == "take_profit_market"
    assert take_profit["stop_price"] == 260.0
    assert take_profit["close_position"] is True
    assert take_profit["trigger_by"] == "mark"

    trailing = orders["usdm:algo-990002"]
    assert trailing["kind"] == "trailing_stop_market"
    assert trailing["activate_price"] == 640.0
    assert trailing["callback_rate"] == pytest.approx(0.018)


def test_standalone_equity_orders_keep_stock_specific_fields(cache):
    order = by_id(build(cache))["equity:eq-open-aapl"]
    assert order["symbol"] == "AAPL" and order["venue"] == "equity"
    assert order["kind"] == "limit" and order["status"] == "partially_filled"
    assert order["quote_asset"] == "USDC"
    assert order["trading_session"] == "rth"
    assert order["notional_usd"] == pytest.approx(2 * 230)


def test_equity_history_and_fills_are_in_the_default_history(cache):
    snap = build(cache)
    assert "AAPL" in snap["history_symbols"]
    order = next(row for row in snap["history"] if row["id"] == "equity:eq-history-nvda")
    fill = next(row for row in snap["fills"] if row["id"] == "equity:teq-fill-nvda")
    assert order["notional_usd"] == 0.0       # 已全部成交，不再占用名义
    assert fill["quote_qty"] == 1000.0
    assert fill["commission"] is None         # 成交接口不提供逐笔手续费
    assert fill["commission_usd"] is None


# --- 历史：接口逼出来的形状 ------------------------------------------------

def test_history_symbols_come_from_orders_positions_and_balances(cache):
    """Binance 没有"我交易过哪些对"的接口，只能从三处推候选。"""
    snap = build(cache)
    assert "NVDAUSDT" in snap["history_symbols"]     # 有持仓
    assert "QQQUSDT" in snap["history_symbols"]      # 有挂单
    assert "BNBUSDT" in snap["history_symbols"]      # 现货有余额且存在该交易对


def test_history_reaches_back_past_a_single_api_window(cache):
    """按 id 翻页，不按时间窗。

    时间窗最多 24 小时（现货）/ 7 天（合约）。只取最近一个窗口的话，上次交易
    在窗口之前就是一片空白——"历史完全没有数据"就是这么来的。
    """
    fut = build(cache, symbol="NVDAUSDT")["query"]
    assert fut["venue"] == "usdm"
    assert fut["max_window_hours"] == 168 and fut["lookback_days"] == 90
    span = datetime.fromisoformat(fut["to"]) - datetime.fromisoformat(fut["from"])
    assert span == timedelta(days=90)     # 回溯到接口的上限，不是单窗口的 7 天

    spot = build(cache, symbol="BNBUSDT")["query"]
    assert spot["venue"] == "spot"
    assert spot["max_window_hours"] == 24 and spot["lookback_days"] is None


def test_no_symbol_means_every_candidate_not_the_first_one(cache):
    """不选交易对 = **全部**，不是"按字母序挑一个"。

    上一版是 `picked = symbol or symbols[0]`：谁都没选的时候页面自己挑了 BNBUSDT，
    于是「委托历史」这一节永远在讲某一个标的，而标题写着的是"委托历史"。
    symbol 必填是 `allOrders` 的限制，不该变成产品的形状——逐个问完合并就是了。
    """
    snap = build(cache)
    assert snap["history_symbols"] == ["AAPL", "BNBUSDT", "NVDA", "NVDAUSDT", "QQQUSDT"]

    q = snap["query"]
    assert q["symbol"] is None            # 没挑，也别装作挑了
    assert q["symbols"] == ["AAPL", "BNBUSDT", "NVDA", "NVDAUSDT", "QQQUSDT"]
    assert q["venue"] is None             # 跨 venue，没有单一答案

    # 现货与合约的记录都在，且按时间倒序合在一起
    assert [o["symbol"] for o in snap["history"]] == ["BNBUSDT", "NVDAUSDT", "NVDAUSDT", "NVDA"]
    assert [f["symbol"] for f in snap["fills"]] == ["BNBUSDT", "NVDAUSDT", "NVDAUSDT", "NVDA"]
    assert [o["created_at"] for o in snap["history"]] == sorted(
        (o["created_at"] for o in snap["history"]), reverse=True)


def _client(handler):
    return BinanceClient("k", "s", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_all_history_asks_each_futures_symbol_not_the_account_wide_query(cache):
    """「全部」的合约委托逐个交易对问，与选定一个走同一条路。

    2026-09-17 线上：「全部」里只剩一笔股票委托，合约委托一条都没有，切换 7/30/90 天
    委托历史纹丝不动（成交明细会变——它一直是逐个问的）；选定任一合约交易对又都查得到。
    原先「全部」用的是省略 symbol 的全账户 allOrders。这里让那个查询返回空，
    模拟线上的样子：合约委托照样要在。
    """
    seen: list[str | None] = []
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/fapi/v1/allOrders":
            params = dict(request.url.params)
            seen.append(params.get("symbol"))
            if "symbol" not in params:
                return httpx.Response(200, json=[])
        return base.handler(request)

    client = _client(handler)
    try:
        snap = build_orders(client, cache, force=True, now=NOW)
    finally:
        client.close()

    assert None not in seen
    assert {"NVDAUSDT", "QQQUSDT"} <= set(seen)
    assert [o["symbol"] for o in snap["history"] if o["venue"] == "usdm"] == ["NVDAUSDT", "NVDAUSDT"]


def test_stock_symbols_stay_in_the_picker_whichever_pair_is_selected(cache):
    """选了合约交易对之后，股票代码不能从下拉框里消失（线上 SOXL 就是这样）。

    原先股票代码只在碰巧出现在本次历史结果里时才进候选。
    """
    snap = build(cache, symbol="NVDAUSDT")
    assert "NVDA" in snap["history_symbols"]
    assert snap["history_venues"]["NVDA"] == "equity"
    assert snap["history_venues"]["NVDAUSDT"] == "usdm"
    assert snap["history_venues"]["BNBUSDT"] == "spot"


def test_one_stock_is_filtered_locally_from_the_account_wide_history(cache):
    """股票历史一次取全账户，选定一只在本地筛。

    原先选定时带着 symbol 去问，却与「全部」共用一个缓存键：5 分钟内先看「全部」
    再选 NVDA，拿到的是缓存里所有股票的委托。
    """
    rows = [*EQUITY_HISTORY["rows"], {**EQUITY_HISTORY["rows"][0],
                                      "orderId": "eq-history-tsla", "symbol": "TSLA"}]
    seen: list[dict[str, str]] = []
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/sapi/v1/equity/order/history":
            seen.append(dict(request.url.params))
            return httpx.Response(200, json={"total": 2, "page": 1, "size": 100, "rows": rows})
        return base.handler(request)

    client = _client(handler)
    try:
        everything = build_orders(client, cache, force=False, now=NOW)
        one = build_orders(client, cache, symbol="NVDA", force=False, now=NOW)
    finally:
        client.close()

    assert {o["symbol"] for o in everything["history"] if o["venue"] == "equity"} == {"NVDA", "TSLA"}
    assert [o["symbol"] for o in one["history"]] == ["NVDA"]
    assert one["query"]["venue"] == "equity"
    assert seen and all("symbol" not in params for params in seen)


def test_closed_futures_positions_are_found_through_income(cache):
    """平掉的仓位不在持仓里、也没有挂单，但 90 天收支里有它的手续费。"""
    income = [*INCOME, {"symbol": "TSLAUSDT", "incomeType": "COMMISSION", "income": "-1.20",
                        "asset": "USDT", "time": int((NOW - timedelta(days=20)).timestamp() * 1000)}]
    seen: list[str | None] = []
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/fapi/v1/income":
            return httpx.Response(200, json=income)
        if request.url.path == "/fapi/v1/allOrders":
            seen.append(dict(request.url.params).get("symbol"))
        return base.handler(request)

    client = _client(handler)
    try:
        snap = build_orders(client, cache, force=True, now=NOW)
    finally:
        client.close()

    assert snap["history_venues"]["TSLAUSDT"] == "usdm"
    assert "TSLAUSDT" in snap["query"]["symbols"]
    assert "TSLAUSDT" in seen


def test_income_failure_marks_all_history_incomplete(cache):
    """「全部」的候选靠收支补全；收支没取到，合并出来的历史可能缺交易对，不能报 ok。"""
    snap = build(cache, fail={"/fapi/v1/income": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["order_history"]["status"] == "unreachable"
    assert states["trade_history"]["status"] == "unreachable"
    assert snap["history"]                      # 取到的照常给


def test_mixed_venues_report_the_tightest_window(cache):
    """多个交易对合在一起时，能保证的只有交集。

    现货单次 24 小时、无回溯上限；合约 7 天、回溯 90 天。报成最宽的那个
    （168 小时 / 无上限）等于替另一半打了包票。
    """
    q = build(cache)["query"]
    assert q["max_window_hours"] == 24    # 现货那半边更紧
    assert q["lookback_days"] == 90       # 合约那半边更紧
    span = datetime.fromisoformat(q["to"]) - datetime.fromisoformat(q["from"])
    assert span == timedelta(days=90)


def test_one_symbol_failing_marks_the_whole_group(cache):
    """合并的历史少了一截时，这一组不能报 ok。

    界面据此才分得出"这个交易对没有记录"和"这一次没取到"。取到的那部分照常给，
    别因为一个交易对挂了就把整页清空——451 常常只打在 fapi 上。
    """
    snap = build(cache, fail={"/fapi/v1/allOrders": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["order_history"]["status"] == "unreachable"
    assert states["trade_history"]["status"] == "ok"      # 成交走另一个端点
    # 现货那半边照常在
    assert [o["symbol"] for o in snap["history"]] == ["BNBUSDT", "NVDA"]


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


def test_commission_comes_with_its_usd_value(cache):
    """手续费的单位是 `commissionAsset`，不是美元。

    现货常用 BNB 抵扣、合约结在 USDT。合并多个交易对之后，界面要把一段区间的
    手续费加起来——不换算就等于把 0.00075 个 BNB 当成 0.00075 美元，
    少掉几百倍。这和 `_income` 那里是同一个坑。
    """
    spot = build(cache, symbol="BNBUSDT")["fills"][0]
    assert spot["commission"] == pytest.approx(0.00075)
    assert spot["commission_asset"] == "BNB"
    assert spot["commission_usd"] == pytest.approx(0.00075 * 682.15)

    fut = build(cache, symbol="NVDAUSDT")["fills"][-1]
    assert fut["commission_asset"] == "USDT"
    assert fut["commission_usd"] == pytest.approx(fut["commission"])


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
                              "/sapi/v1/equity": 451,
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
