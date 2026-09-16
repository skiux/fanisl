"""Current Binance read-only endpoint contracts that are easy to regress silently."""

import httpx

from fanisl.binance.client import BinanceClient


def test_current_futures_versions_and_wallet_detail_parameter():
    seen: list[tuple[str, dict[str, str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen.append((request.url.path, dict(request.url.params)))
        return httpx.Response(200, json=[])

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.wallet_balance()
        client.futures_account()
        client.futures_position_risk()
        client.futures_open_algo_orders()
    finally:
        client.close()

    by_path = {path: params for path, params in seen}
    assert by_path["/sapi/v1/asset/wallet/balance"]["needBalanceDetail"] == "true"
    assert "/fapi/v3/account" in by_path
    assert "/fapi/v3/positionRisk" in by_path
    assert "/fapi/v1/openAlgoOrders" in by_path


def test_futures_all_orders_can_query_the_whole_account():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen.update(dict(request.url.params))
        return httpx.Response(200, json=[])

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.futures_all_orders(None, start_ms=1, end_ms=2)
    finally:
        client.close()

    assert "symbol" not in seen
    assert seen["startTime"] == "1" and seen["endTime"] == "2"


def test_equity_market_data_uses_api_key_without_a_signature():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        seen["key"] = request.headers.get("X-MBX-APIKEY")
        return httpx.Response(200, json={"timezone": "UTC", "symbols": []})

    client = BinanceClient("key-only", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.equity_exchange_info()
    finally:
        client.close()

    assert seen == {"path": "/sapi/v1/equity/market/exchangeInfo",
                    "params": {}, "key": "key-only"}


def test_equity_history_paginates_the_documented_envelope():
    pages = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        current = int(request.url.params["current"])
        pages.append(current)
        rows = [{"orderId": f"o-{current}"}] if current < 3 else []
        return httpx.Response(200, json={"total": 2, "page": current,
                                         "size": 1, "rows": rows})

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        rows = client.equity_order_history(start_ms=1, end_ms=2, size=1)
    finally:
        client.close()

    assert pages == [1, 2]
    assert [row["orderId"] for row in rows] == ["o-1", "o-2"]


def test_tradfi_metadata_endpoints_are_public_reads():
    paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json=[])

    client = BinanceClient("", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.futures_exchange_info()
        client.futures_trading_schedule()
        client.futures_symbol_adl_risk()
    finally:
        client.close()

    assert paths == ["/fapi/v1/exchangeInfo", "/fapi/v1/tradingSchedule",
                     "/fapi/v1/symbolAdlRisk"]
