"""Venue-scoped order history, including cross-margin's separate SAPI endpoints."""

from datetime import datetime, timezone

import httpx

from fanisl.binance.client import BinanceClient
from fanisl.binance.orders import build_orders

from binance_mock import FUT_OPEN, NOW, SPOT_ALL_ORDERS, SPOT_MY_TRADES, make_transport


class MemoryCache:
    """Exercise source assembly without requiring the integration test database."""

    def read(self, key):
        return None

    def write(self, key, payload, *, status="ok", detail=None):
        return datetime.now(timezone.utc)

    def note_failure(self, key, status, detail):
        pass


MARGIN_ORDER = {**SPOT_ALL_ORDERS[0], "isIsolated": False}
MARGIN_TRADE = {**SPOT_MY_TRADES[0], "isIsolated": False}


def snapshot(venue, handler):
    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        return build_orders(client, MemoryCache(), venue=venue, force=True, now=NOW)
    finally:
        client.close()


def state(snapshot, key):
    return next(source for source in snapshot["sources"] if source["key"] == key)


def test_cross_margin_uses_its_own_endpoints_and_id_cursors():
    seen = []

    def handler(request):
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        path = request.url.path
        params = dict(request.url.params)
        seen.append((request.url.host, path, params))
        if path == "/sapi/v1/margin/allOrders":
            ids = [100, 101] if params["orderId"] == "0" else [102]
            return httpx.Response(200, json=[{"orderId": order_id} for order_id in ids])
        if path == "/sapi/v1/margin/myTrades":
            ids = [10, 11] if params["fromId"] == "0" else [12]
            return httpx.Response(200, json=[{"id": trade_id} for trade_id in ids])
        return httpx.Response(404, json={"code": -1121, "msg": path})

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        orders = client.orders_since("BNBUSDT", venue="margin", limit=2)
        trades = client.margin_trades_since("BNBUSDT", limit=2)
        client.orders_since("BNBUSDT", venue="margin", max_pages=1)
    finally:
        client.close()

    assert [row["orderId"] for row in orders] == [100, 101, 102]
    assert [row["id"] for row in trades] == [10, 11, 12]
    assert [(host, path) for host, path, _ in seen] == [
        ("api.binance.com", "/sapi/v1/margin/allOrders"),
        ("api.binance.com", "/sapi/v1/margin/allOrders"),
        ("api.binance.com", "/sapi/v1/margin/myTrades"),
        ("api.binance.com", "/sapi/v1/margin/myTrades"),
        ("api.binance.com", "/sapi/v1/margin/allOrders"),
    ]
    assert [params["orderId"] for _, path, params in seen if path.endswith("allOrders")] == ["0", "102", "0"]
    assert [params["fromId"] for _, path, params in seen if path.endswith("myTrades")] == ["0", "12"]
    assert all(params["isIsolated"] == "FALSE" for _, _, params in seen)
    assert seen[-1][2]["limit"] == "500"


def test_spot_and_margin_snapshots_keep_same_symbol_and_ids_separate():
    base = make_transport()

    def handler(request):
        if request.url.path == "/sapi/v1/margin/allOrders":
            return httpx.Response(200, json=[MARGIN_ORDER])
        if request.url.path == "/sapi/v1/margin/myTrades":
            return httpx.Response(200, json=[MARGIN_TRADE])
        return base.handler(request)

    spot = snapshot("spot", handler)
    margin = snapshot("margin", handler)

    assert "BNBUSDT" in spot["query"]["symbols"]
    assert margin["query"]["symbols"] == ["BNBUSDT"]
    assert [order["id"] for order in spot["history"] if order["symbol"] == "BNBUSDT"] == ["spot:4000001"]
    assert [order["id"] for order in margin["history"]] == ["margin:4000001"]
    assert [fill["id"] for fill in margin["fills"]] == ["margin:t910001"]
    assert all(order["venue"] == "margin" for order in margin["history"])


def test_spot_candidate_survives_same_symbol_in_futures_without_spot_open_order():
    base = make_transport()

    def handler(request):
        if request.url.path == "/api/v3/openOrders":
            return httpx.Response(200, json=[])
        if request.url.path == "/fapi/v1/openOrders":
            return httpx.Response(200, json=[*FUT_OPEN,
                {**FUT_OPEN[0], "orderId": 5200999, "symbol": "BNBUSDT"}])
        return base.handler(request)

    spot = snapshot("spot", handler)
    assert "BNBUSDT" in spot["query"]["symbols"]
    assert [order["id"] for order in spot["history"] if order["symbol"] == "BNBUSDT"] == ["spot:4000001"]


def test_margin_account_asset_discovers_history_after_open_order_is_gone():
    base = make_transport()

    def handler(request):
        path = request.url.path
        if path == "/sapi/v1/margin/openOrders":
            return httpx.Response(200, json=[])
        if path == "/sapi/v1/margin/account":
            return httpx.Response(200, json={"userAssets": [
                {"asset": "BNB", "free": "1", "locked": "0", "borrowed": "0", "netAsset": "1"}]})
        if path == "/sapi/v1/margin/allOrders":
            return httpx.Response(200, json=[MARGIN_ORDER])
        if path == "/sapi/v1/margin/myTrades":
            return httpx.Response(200, json=[MARGIN_TRADE])
        return base.handler(request)

    margin = snapshot("margin", handler)
    assert margin["query"]["symbols"] == ["BNBUSDT"]
    assert [order["id"] for order in margin["history"]] == ["margin:4000001"]


def test_spot_and_equity_history_do_not_inherit_futures_income_failure():
    base = make_transport(fail={"/fapi/v1/income": 451})
    for venue in ("spot", "equity"):
        snap = snapshot(venue, base.handler)
        assert state(snap, "order_history")["status"] == "ok"
        assert state(snap, "trade_history")["status"] == "ok"


def test_equity_history_failure_is_reported_even_without_any_candidate():
    base = make_transport()

    def handler(request):
        if request.url.path == "/sapi/v1/equity/order/open-orders":
            return httpx.Response(200, json=[])
        if request.url.path in ("/sapi/v1/equity/order/history", "/sapi/v1/equity/trade/history"):
            return httpx.Response(451, json={"code": -1000, "msg": "blocked"})
        return base.handler(request)

    equity = snapshot("equity", handler)
    assert equity["query"] is None
    assert state(equity, "order_history")["status"] == "unreachable"
    assert state(equity, "trade_history")["status"] == "unreachable"


def test_spot_candidate_failure_is_reported_even_without_targets():
    base = make_transport()

    def handler(request):
        if request.url.path == "/api/v3/openOrders":
            return httpx.Response(451, json={"code": -1000, "msg": "blocked"})
        if request.url.path == "/sapi/v3/asset/getUserAsset":
            return httpx.Response(200, json=[])
        if request.url.path == "/sapi/v1/margin/openOrders":
            return httpx.Response(200, json=[])
        return base.handler(request)

    spot = snapshot("spot", handler)
    assert spot["query"] is None
    assert state(spot, "order_history")["status"] == "unreachable"
    assert state(spot, "trade_history")["status"] == "unreachable"
