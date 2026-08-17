"""盈利预期修正采集：口径与"不写半行"的约束（不联网）。"""

import datetime as dt

import pandas as pd
import pytest

from analyzer.knowledge import estimates
from analyzer.knowledge.store import KnowledgeStore


@pytest.fixture
def kstore(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, "
                     "knowledge_units, claim_scores, spot_checks, keyframes "
                     "RESTART IDENTITY CASCADE")
    return st


class _FakeTicker:
    def __init__(self, trend=None, revisions=None, boom=False):
        self._trend, self._rev, self._boom = trend, revisions, boom

    @property
    def eps_trend(self):
        if self._boom:
            raise RuntimeError("yfinance 抽风")
        return self._trend

    @property
    def eps_revisions(self):
        return self._rev


def _install(monkeypatch, ticker):
    fake_yf = type("m", (), {"Ticker": staticmethod(lambda *_a, **_k: ticker)})
    monkeypatch.setitem(__import__("sys").modules, "yfinance", fake_yf)


def _trend_df(**over):
    base = {"current": 2.219, "7daysAgo": 2.240, "30daysAgo": 2.518,
            "60daysAgo": 2.526, "90daysAgo": 2.550}
    base.update(over)
    return pd.DataFrame([base], index=["+1y"])


def test_reads_the_forward_year_series(monkeypatch):
    rev = pd.DataFrame([{"upLast30days": 4, "downLast30days": 19}], index=["+1y"])
    _install(monkeypatch, _FakeTicker(_trend_df(), rev))
    got = estimates.fetch_eps_trend("TSLA")
    assert got["current"] == pytest.approx(2.219)
    assert got["d90"] == pytest.approx(2.550)
    assert (got["up_30d"], got["down_30d"]) == (4, 19)


def test_missing_period_returns_none_not_a_half_row(monkeypatch):
    """抓不到就整条跳过——空值会让'修正为 0'和'没数据'混淆。"""
    _install(monkeypatch, _FakeTicker(pd.DataFrame([{"current": 1.0}], index=["0q"])))
    assert estimates.fetch_eps_trend("XLU") is None


def test_empty_or_raising_source_returns_none(monkeypatch):
    _install(monkeypatch, _FakeTicker(pd.DataFrame()))
    assert estimates.fetch_eps_trend("NOPE") is None
    _install(monkeypatch, _FakeTicker(boom=True))
    assert estimates.fetch_eps_trend("BOOM") is None


def test_nan_current_is_treated_as_no_data(monkeypatch):
    _install(monkeypatch, _FakeTicker(_trend_df(current=float("nan"))))
    assert estimates.fetch_eps_trend("NANCO") is None


def test_revisions_failure_does_not_lose_the_main_series(monkeypatch):
    """修正家数是加分项，缺了不该把整条预期序列一起丢掉。"""
    class _T(_FakeTicker):
        @property
        def eps_revisions(self):
            raise RuntimeError("没有这块数据")

    _install(monkeypatch, _T(_trend_df()))
    got = estimates.fetch_eps_trend("TSLA")
    assert got is not None and got["current"] == pytest.approx(2.219)
    assert got["up_30d"] is None and got["down_30d"] is None


def test_default_period_is_next_fiscal_year_not_current(monkeypatch):
    """0y 会在财年切换时跳变（谷歌实测 14.24→20.58），那是换年份不是修正，跨期不可比。"""
    df = pd.DataFrame(
        [{"current": 20.58, "7daysAgo": 20.58, "30daysAgo": 14.24,
          "60daysAgo": 14.23, "90daysAgo": 14.24},
         {"current": 14.74, "7daysAgo": 14.73, "30daysAgo": 14.58,
          "60daysAgo": 14.45, "90daysAgo": 14.45}],
        index=["0y", "+1y"])
    _install(monkeypatch, _FakeTicker(df))
    got = estimates.fetch_eps_trend("GOOG")            # 不传 period
    assert got["current"] == pytest.approx(14.74), "默认必须取 +1y"
    assert got["d90"] == pytest.approx(14.45)


def test_tracked_symbols_excludes_indices_futures_and_fx(kstore):
    """指数/期货/汇率没有卖方一致预期，放进去只会每天刷一屏 404。"""
    syms = estimates.tracked_symbols(kstore.pool)
    from analyzer.knowledge.prices import SYMBOL_MAP
    for s in syms:
        ticker = SYMBOL_MAP[s][0]
        assert not ticker.startswith("^") and "=" not in ticker, f"{s}→{ticker} 不该进来"
