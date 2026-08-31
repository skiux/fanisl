"""标的参考数据的存储层：资料 upsert 幂等、新闻**追加不覆盖**、覆盖度统计。

外部源不在这里测（要联网、要 key）；这里守的是"存进来之后行为对不对"，
尤其是与 marketstore.replace_catalysts 相反的那条：新闻只增不删。
"""

from datetime import datetime, timezone

import pytest

from analyzer.knowledge.reference import (
    ReferenceStore, dedup_key, earnings_assets, ticker_assets,
)


@pytest.fixture
def store(pool):
    st = ReferenceStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE asset_profiles, news_items, asset_events RESTART IDENTITY")
    return st


def _news(title: str, url: str | None, day: str) -> dict:
    return {
        "published_at": f"{day}T09:00:00+00:00", "title": title, "summary": "摘要",
        "url": url, "source": "TestWire", "provider": "finnhub", "image_url": None,
    }


def test_profile_upsert_is_idempotent_and_keeps_field_sources(store):
    store.upsert_profile("NVDA", {
        "name": "Nvidia Corp", "industry": "SEMICONDUCTORS", "market_cap": 5.2e12,
        "cik": "0001045810", "listed_on": "1999-01-22",
        "metrics": {"pe_ttm": 34.0}, "sources": {"name": "polygon", "metrics": "finnhub"},
    })
    store.upsert_profile("NVDA", {
        "name": "NVIDIA Corporation", "industry": "SEMICONDUCTORS", "market_cap": 5.3e12,
        "metrics": {"pe_ttm": 35.0}, "sources": {"name": "finnhub"},
    })

    row = store.profile("NVDA")
    assert row["name"] == "NVIDIA Corporation"      # 覆盖，不新增一行
    assert row["metrics"]["pe_ttm"] == 35.0
    assert row["sources"]["name"] == "finnhub"
    assert len(store.profile_coverage()) == 1


def test_news_is_append_only_and_deduped_by_url(store):
    first = store.add_news("NVDA", [
        _news("第一条", "https://example.test/a", "2026-08-20"),
        _news("第二条", "https://example.test/b", "2026-08-21"),
    ])
    # 第二轮把旧条又抓了一遍，外加一条新的：旧条不重复入库，也**不被删掉**
    second = store.add_news("NVDA", [
        _news("第一条（标题被改写了）", "https://example.test/a", "2026-08-20"),
        _news("第三条", "https://example.test/c", "2026-08-22"),
    ])

    assert (first, second) == (2, 1)
    rows = store.news("NVDA")
    assert [row["title"] for row in rows] == ["第三条", "第二条", "第一条"]   # 时间倒序
    assert len(rows) == 3


def test_news_without_url_falls_back_to_normalised_title(store):
    assert dedup_key({"url": " https://Example.test/A/ ", "title": "x"}) == "https://example.test/a"
    assert dedup_key({"url": None, "title": " 同 一 条 新闻 "}) == "同一条新闻"

    store.add_news("SOXX", [_news("同一条新闻", None, "2026-08-20")])
    store.add_news("SOXX", [_news("同 一 条 新闻", None, "2026-08-21")])
    assert len(store.news("SOXX")) == 1


def test_news_coverage_counts_per_asset(store):
    store.add_news("NVDA", [_news("a", "https://example.test/1", "2026-08-20")])
    store.add_news("SOXX", [_news("b", "https://example.test/2", "2026-08-21"),
                            _news("c", "https://example.test/3", "2026-08-22")])
    coverage = store.news_coverage()
    assert coverage["NVDA"]["n"] == 1
    assert coverage["SOXX"]["n"] == 2
    assert coverage["SOXX"]["latest"] == datetime(2026, 8, 22, 9, tzinfo=timezone.utc)


def test_only_real_tickers_are_asked_for_company_data():
    """指数/金属/原油没有公司；代理映射（WTI→CL=F）也不是 ticker，都不该去问外部源。"""
    ids = {asset.id for asset in ticker_assets()}
    assert {"NVDA", "SOXX", "QQQ"} <= ids
    assert not ({"XAUUSD", "SPX", "WTI", "NDX", "BTCUSDT", "US10Y"} & ids)


def _earning(date: str, *, estimate: float, actual: float | None = None) -> dict:
    return {"event_date": date, "session": "amc",
            "payload": {"quarter": 3, "fiscal_year": 2027,
                        "eps_estimate": estimate, "eps_actual": actual}}


def test_events_are_upserted_because_dates_move_and_estimates_get_revised(store):
    """与新闻相反：日历事件要的是**最新一版**，日期会挪、预期会被修正。"""
    store.upsert_events("NVDA", "earnings", [_earning("2026-11-17", estimate=2.46)], source="finnhub")
    store.upsert_events("NVDA", "earnings", [_earning("2026-11-17", estimate=2.51)], source="finnhub")

    rows = store.events("NVDA", kind="earnings")
    assert len(rows) == 1
    assert rows[0]["payload"]["eps_estimate"] == 2.51


def test_events_come_back_in_date_order_and_next_one_is_queryable(store):
    store.upsert_events("NVDA", "earnings", [
        _earning("2026-08-26", estimate=2.13, actual=2.22),
        _earning("2027-02-23", estimate=2.77),
        _earning("2026-11-17", estimate=2.46),
    ], source="finnhub")

    assert [str(r["event_date"]) for r in store.events("NVDA")] == [
        "2026-08-26", "2026-11-17", "2027-02-23"]
    nxt = store.next_events()["NVDA"]
    assert str(nxt["event_date"]) == "2026-11-17"      # 已过去的那次不算"下一次"


def test_only_single_stocks_are_asked_for_earnings():
    """ETF 不报财报（SOXX 实测返回 0 条），指数/金属更不会——别把空当成抓失败。"""
    ids = {asset.id for asset in earnings_assets()}
    assert {"NVDA", "MSFT", "INTC"} <= ids
    assert not ({"SOXX", "IGV", "QQQ", "XAUUSD", "SPX"} & ids)
