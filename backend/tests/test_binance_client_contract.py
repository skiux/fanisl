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
