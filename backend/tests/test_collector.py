"""采集器单测：mock 工具函数，验证写库 + 运行日志（不联网）。"""

from analyzer import collector
from analyzer.config import Settings
from analyzer.marketstore import MarketStore
from analyzer.models import CatalystReport, MacroEvent


def test_collect_market_writes_series(tmp_path, monkeypatch, make_snapshot):
    st = MarketStore(str(tmp_path / "t.db"))
    monkeypatch.setattr(
        collector, "get_market_snapshot",
        lambda sym, tfs, r, s, sent: make_snapshot(sym, price=123.0),
    )
    settings = Settings(watchlist=["BTC/USDT", "ETH/USDT"])
    collect = collector.collect_market
    collect(None, settings, None, st)

    assert st.latest_metrics("BTC/USDT")["price"]["value"] == 123.0
    assert st.latest_metrics("ETH/USDT")["price"]["value"] == 123.0
    status = st.status()[0]
    assert status["job"] == "market" and status["ok"] == 1
    assert "2/2 ok" in status["note"]


def test_collect_market_best_effort_on_failure(tmp_path, monkeypatch, make_snapshot):
    st = MarketStore(str(tmp_path / "t.db"))

    def flaky(sym, tfs, r, s, sent):
        if sym == "ETH/USDT":
            raise RuntimeError("boom")
        return make_snapshot(sym)

    monkeypatch.setattr(collector, "get_market_snapshot", flaky)
    settings = Settings(watchlist=["BTC/USDT", "ETH/USDT"])
    collector.collect_market(None, settings, None, st)

    assert st.latest_metrics("BTC/USDT")  # 成功的照常写
    assert st.latest_metrics("ETH/USDT") == {}  # 失败的没写
    run = st.status()[0]
    assert run["ok"] == 0 and "ETH/USDT" in run["note"]  # 记录失败


def test_collect_catalysts_writes_once_for_macro(tmp_path, monkeypatch):
    st = MarketStore(str(tmp_path / "t.db"))
    monkeypatch.setattr(
        collector, "get_catalysts",
        lambda sym, cat: CatalystReport(
            symbol=sym, macro_calendar=[MacroEvent(date="2026-06-10", name="CPI")]
        ),
    )
    settings = Settings(watchlist=["BTC/USDT", "ETH/USDT"])
    collector.collect_catalysts(None, settings, st)

    macro = [c for c in st.get_catalysts() if c["kind"] == "macro"]
    assert len(macro) == 1  # 宏观全市场，每周期只写一次（不随币重复）
