"""杠杆利息按小时计：一个借币一天 24 条，接口单页最多 100 条、单次跨度最多 30 天。

原先只问一页：资产页按 90 天问（超出跨度），流水页 7 天也超过一页，
只剩最近两三天有利息，更早的日子全是 0。
"""

import pytest

from fanisl.binance.client import (
    MARGIN_INTEREST_WINDOW_MS, BinanceClient, BinanceError,
)

DAY = 86_400_000


def fake_history(rows_per_window=lambda start, end: []):
    calls = []

    def signed_get(self, base, path, params):
        calls.append(params)
        rows = rows_per_window(params["startTime"], params["endTime"])
        size, current = params["size"], params["current"]
        return {"total": len(rows), "rows": rows[(current - 1) * size: current * size]}

    return calls, signed_get


def hourly(start, end):
    """整点一条，和真接口一样落在固定的钟点上，而不是从每段窗口的起点数起"""
    hour = 3_600_000
    first = -(-start // hour) * hour
    return [{"txId": t, "interestAccuredTime": t, "asset": "USDT", "interest": "0.01"}
            for t in range(first, end + 1, hour)]


def test_every_page_of_every_window_is_fetched(monkeypatch):
    calls, signed_get = fake_history(hourly)
    monkeypatch.setattr(BinanceClient, "signed_get", signed_get)
    client = BinanceClient("key", "secret")

    got = client.margin_interest_history(start_ms=0, end_ms=7 * DAY)

    # 7 天按小时 = 169 条，单页 100 → 两页，一条都不少
    assert len(got["rows"]) == 7 * 24 + 1
    assert [call["current"] for call in calls] == [1, 2]


def test_a_90_day_window_is_cut_into_30_day_pieces(monkeypatch):
    calls, signed_get = fake_history(hourly)
    monkeypatch.setattr(BinanceClient, "signed_get", signed_get)
    client = BinanceClient("key", "secret")

    got = client.margin_interest_history(start_ms=0, end_ms=90 * DAY)

    assert all(call["endTime"] - call["startTime"] <= MARGIN_INTEREST_WINDOW_MS for call in calls)
    # 窗口首尾相接、不重叠：同一条利息不会被算两遍
    ids = [row["txId"] for row in got["rows"]]
    assert len(ids) == len(set(ids)) == 90 * 24 + 1


def test_a_malformed_page_is_refused(monkeypatch):
    monkeypatch.setattr(BinanceClient, "signed_get",
                        lambda self, base, path, params: {"rows": "oops"})
    with pytest.raises(BinanceError):
        BinanceClient("key", "secret").margin_interest_history(start_ms=0, end_ms=DAY)


def test_too_many_pages_fail_instead_of_returning_a_truncated_list(monkeypatch):
    _, signed_get = fake_history(lambda start, end: [{"txId": i} for i in range(10_000)])
    monkeypatch.setattr(BinanceClient, "signed_get", signed_get)
    with pytest.raises(BinanceError):
        BinanceClient("key", "secret").margin_interest_history(
            start_ms=0, end_ms=DAY, max_pages=3)
