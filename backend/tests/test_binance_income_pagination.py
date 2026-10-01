"""合约收入跨页时，历史资金费与平仓盈亏不能被首批 1000 条截断。"""

from fanisl.binance.client import BinanceClient


def test_futures_income_fetches_all_pages(monkeypatch):
    calls = []

    def signed_get(self, base, path, params):
        calls.append((base, path, params))
        return ([{"tranId": 1}, {"tranId": 2}] if params["page"] == 1
                else [{"tranId": 3}])

    monkeypatch.setattr(BinanceClient, "signed_get", signed_get)
    client = BinanceClient("key", "secret")

    rows = client.futures_income(start_ms=100, end_ms=200, limit=2)

    assert [row["tranId"] for row in rows] == [1, 2, 3]
    assert [call[2]["page"] for call in calls] == [1, 2]
    assert all(call[2]["startTime"] == 100 and call[2]["endTime"] == 200
               for call in calls)
