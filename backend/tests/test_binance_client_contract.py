"""Current Binance read-only endpoint contracts that are easy to regress silently."""

import httpx
import pytest

from fanisl.binance.client import BinanceClient, BinanceError


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
        client.futures_symbol_config()
        client.futures_open_algo_orders()
    finally:
        client.close()

    by_path = {path: params for path, params in seen}
    assert by_path["/sapi/v1/asset/wallet/balance"]["needBalanceDetail"] == "true"
    assert "/fapi/v3/account" in by_path
    assert "/fapi/v3/positionRisk" in by_path
    assert "/fapi/v1/symbolConfig" in by_path     # v3 之后杠杆与逐仓只有这里有
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


def test_bfusd_rate_history_uses_current_simple_earn_endpoint():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"rows": [], "total": "0"})

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.bfusd_rate_history(current=1, size=1)
    finally:
        client.close()

    assert seen["path"] == "/sapi/v1/bfusd/history/rateHistory"
    assert seen["params"]["current"] == "1"
    assert seen["params"]["size"] == "1"


def test_equity_history_fails_closed_when_page_guard_truncates_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        return httpx.Response(200, json={
            "total": 2,
            "page": 1,
            "size": 1,
            "rows": [{"orderId": "o-1"}],
        })

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        with pytest.raises(BinanceError, match="分页上限") as error:
            client.equity_order_history(start_ms=1, end_ms=2, size=1, max_pages=1)
    finally:
        client.close()

    assert error.value.kind == "unsupported"


def test_equity_history_rejects_repeated_pages_even_when_raw_count_reaches_total():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        current = int(request.url.params["current"])
        return httpx.Response(200, json={
            "total": 2, "page": current, "size": 1,
            "rows": [{"orderId": "same-order"}],
        })

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        with pytest.raises(BinanceError, match="重复") as error:
            client.equity_order_history(start_ms=1, end_ms=2, size=1)
    finally:
        client.close()

    assert error.value.kind == "unsupported"


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


def test_account_capability_and_margin_risk_reads_use_current_paths():
    paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        paths.append(request.url.path)
        return httpx.Response(200, json={})

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.account_info()
        client.api_restrictions()
        client.isolated_margin_account()
        client.margin_liquidation_loan()
    finally:
        client.close()

    assert paths == [
        "/sapi/v1/account/info",
        "/sapi/v1/account/apiRestrictions",
        "/sapi/v1/margin/isolated/account",
        "/sapi/v1/margin/liquidation-loan",
    ]


def test_empty_success_body_is_no_record_only_where_measured():
    """强平借款没有记录时回 200 + 空响应体（2026-09-17 线上实测），换成 `{}`。

    别的端点回 200 但不是 JSON 是上游异常，必须抛 `BinanceError`——抛 `ValueError`
    的话缓存层接不住，整页 500。
    """
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        return httpx.Response(200, content=b"")

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        assert client.margin_liquidation_loan() == {}
        with pytest.raises(BinanceError) as error:
            client.isolated_margin_account()
    finally:
        client.close()

    assert error.value.kind == "unreachable"
    assert error.value.status == 200


def test_portfolio_margin_reads_use_papi_and_sapi_contracts():
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen.append((request.url.host, request.url.path))
        return httpx.Response(200, json={})

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        client.portfolio_margin_pro_account()
        client.portfolio_margin_pro_account(span=True)
        client.portfolio_margin_pro_balance()
        client.portfolio_margin_account()
        client.portfolio_margin_um_account()
        client.portfolio_margin_um_position_risk()
    finally:
        client.close()

    assert seen == [
        ("api.binance.com", "/sapi/v1/portfolio/account"),
        ("api.binance.com", "/sapi/v2/portfolio/account"),
        ("api.binance.com", "/sapi/v1/portfolio/balance"),
        ("papi.binance.com", "/papi/v1/account"),
        ("papi.binance.com", "/papi/v2/um/account"),
        ("papi.binance.com", "/papi/v1/um/positionRisk"),
    ]


def test_earn_rewards_history_splits_90_days_into_30_day_windows_and_pages():
    """派息记录单次跨度超过 30 天回 -6021；逐日盈亏按 90 天问，2026-09-05 起两个来源每次都失败。"""
    day = 86_400_000
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        p = dict(request.url.params)
        seen.append(p)
        span = int(p["endTime"]) - int(p["startTime"])
        if span > 30 * day:
            return httpx.Response(400, json={"code": -6021, "msg": "Query time range too large"})
        # 每个窗口 3 条，每页 2 条：第 1 页满、第 2 页 1 条
        page = int(p["current"])
        rows = [{"asset": "USDT", "rewards": "0.1", "time": int(p["startTime"]) + k}
                for k in range(3)][(page - 1) * 2: page * 2]
        return httpx.Response(200, json={"rows": rows, "total": 3})

    client = BinanceClient("k", "s", client=httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        out = client.earn_rewards_history("flexible", start_ms=0, end_ms=90 * day, size=2)
    finally:
        client.close()

    spans = {(int(p["startTime"]), int(p["endTime"])) for p in seen}
    assert all(e - s <= 30 * day for s, e in spans)
    starts = sorted(s for s, _ in spans)
    assert starts[0] == 0 and max(e for _, e in spans) == 90 * day, "窗口首尾要覆盖整个区间"
    assert len(spans) == 3 and len(out["rows"]) == 9 == out["total"], "90 天正好切三段，每段翻两页"
    assert all(p["type"] == "ALL" for p in seen)


def test_earn_rewards_history_fails_closed_past_the_page_cap():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        return httpx.Response(200, json={"rows": [{"asset": "BTC", "amount": "1"}], "total": 5})

    client = BinanceClient("k", "s", client=httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        with pytest.raises(BinanceError, match="分页上限") as error:
            client.earn_rewards_history("locked", start_ms=0, end_ms=1000, size=1, max_pages=2)
    finally:
        client.close()
    assert error.value.kind == "unsupported"
