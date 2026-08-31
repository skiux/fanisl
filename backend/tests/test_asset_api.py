"""/assets 与 /assets/{id} 的契约：形状、覆盖标记、别名、空档案与 404。

直接调端点函数（同 test_keyframe_api 的做法），不起 HTTP 服务；库是 fanisl_test。
"""

import pytest

from analyzer.knowledge.reference import ReferenceStore
from analyzer.main import asset_detail, assets_index
from analyzer.runtime import knowledge_store
from fastapi import HTTPException


@pytest.fixture
def reference(pool):
    store = ReferenceStore(knowledge_store.pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE asset_profiles, news_items, asset_events RESTART IDENTITY")
    return store


def test_index_lists_assets_with_counts_and_coverage(pool, knowledge_corpus):
    payload = assets_index()
    rows = {r["asset"]: r for r in payload["assets"]}

    assert payload["total"] == len(payload["assets"])
    assert payload["classes"]["stock"] == "个股"
    nvda = rows["NVDA"]
    assert nvda["units"] == 6 and nvda["claims"] == 3
    assert nvda["display"] == "英伟达" and nvda["class_label"] == "个股"
    assert nvda["open_claims"] == 1              # 未到期判断的条数（按 claim 去重）
    assert "bars" in nvda and "news" in nvda        # 覆盖标记必须在，哪怕是 None


def test_index_hides_registered_but_empty_assets_by_default(pool, knowledge_corpus):
    listed = {r["asset"] for r in assets_index()["assets"]}
    assert "QQQ" not in listed                      # 登记了、库里没单元、也没交易过

    with_empty = {r["asset"]: r for r in assets_index(include_empty=True)["assets"]}
    assert with_empty["QQQ"]["units"] == 0
    assert with_empty["QQQ"]["display"] == "纳斯达克100 ETF"
    assert with_empty["QQQ"]["hit_rate"] is None    # 没样本不是 0


def test_detail_resolves_aliases_to_one_dossier(pool, knowledge_corpus):
    for spelling in ("XAUUSD", "xauusd", "XAU/USD", "gold"):
        d = asset_detail(spelling)
        assert d["asset"] == "XAUUSD", spelling
        assert d["identity"]["display"] == "黄金"
        assert d["summary"]["claims"] == 1


def test_detail_carries_the_decision_blocks(pool, knowledge_corpus):
    d = asset_detail("NVDA")
    assert [c["horizon_label"] for c in d["open_claims"]] == ["2099-06-30", "2099-12-31"]
    assert d["summary"]["open_claims"] == 1      # 条数 ≠ 时点数
    assert len(d["settled_claims"]) == 3
    assert [n["title"] for n in d["nodes"]] == ["算力定价"]
    assert d["disagreements"]["relations"][0]["relation"] == "conflicts"
    assert d["disagreements"]["evolution"][0]["relation"] == "supersedes"
    assert d["related_assets"][0]["asset"] == "SOXX"
    assert d["coverage"]["instrument"] == "NVDA"
    assert "bars_window" in d["coverage"] and "news" in d["coverage"]


def test_detail_of_a_registered_asset_without_units_is_empty_not_missing(pool, knowledge_corpus):
    """"我们知道它是什么，只是还没人讲过它" 与 "查无此物" 是两回事。"""
    d = asset_detail("QQQ")
    assert d["summary"] is None
    assert d["identity"]["registered"] is True
    assert d["open_claims"] == [] and d["nodes"] == []
    assert d["coverage"]["bars"] is False           # QQQ 未采日线


def test_detail_of_an_unknown_symbol_is_404(pool, knowledge_corpus):
    with pytest.raises(HTTPException) as e:
        asset_detail("NOSUCHTHING")
    assert e.value.status_code == 404


def test_dossier_carries_company_profile_and_news(pool, knowledge_corpus, reference):
    reference.upsert_profile("NVDA", {
        "name": "NVIDIA Corporation", "industry": "SEMICONDUCTORS", "market_cap": 5.2e12,
        "metrics": {"pe_ttm": 34.0}, "sources": {"name": "polygon"},
    })
    reference.add_news("NVDA", [{
        "published_at": "2026-08-28T09:00:00+00:00", "title": "英伟达发布财报",
        "summary": "摘要", "url": "https://example.test/n1", "source": "TestWire",
        "provider": "finnhub", "image_url": None,
    }])

    d = asset_detail("NVDA")
    assert d["profile"]["name"] == "NVIDIA Corporation"
    assert d["profile"]["metrics"]["pe_ttm"] == 34.0
    assert [n["title"] for n in d["news"]] == ["英伟达发布财报"]
    assert d["coverage"]["news"]["n"] == 1
    assert d["coverage"]["has_company"] is True


def test_assets_without_a_company_say_so(pool, knowledge_corpus, reference):
    """指数/金属/利率没有"公司"——这是事实，不是"我们没接"。"""
    for symbol in ("XAUUSD", "SPX", "US10Y"):
        d = asset_detail(symbol)
        assert d["coverage"]["has_company"] is False, symbol
        assert d["profile"] is None
        assert d["news"] == []


def test_index_reports_profile_and_news_coverage(pool, knowledge_corpus, reference):
    reference.upsert_profile("NVDA", {"name": "NVIDIA Corporation"})
    rows = {r["asset"]: r for r in assets_index()["assets"]}
    assert rows["NVDA"]["profile_at"] is not None
    assert rows["XAUUSD"]["profile_at"] is None
    assert rows["NVDA"]["news"] is None          # 还没抓过新闻就如实是 None


def test_dossier_carries_the_earnings_calendar(pool, knowledge_corpus, reference):
    reference.upsert_events("NVDA", "earnings", [
        {"event_date": "2026-08-26", "session": "amc",
         "payload": {"quarter": 2, "eps_estimate": 2.13, "eps_actual": 2.22}},
        {"event_date": "2026-11-17", "session": "amc",
         "payload": {"quarter": 3, "eps_estimate": 2.46, "eps_actual": None}},
    ], source="finnhub")

    d = asset_detail("NVDA")
    assert [str(e["event_date"]) for e in d["events"]] == ["2026-08-26", "2026-11-17"]
    assert d["coverage"]["has_earnings"] is True

    # ETF 不报财报，指数更不会——两者都是事实，不是"没抓到"
    assert asset_detail("SOXX")["coverage"]["has_earnings"] is False
    assert asset_detail("XAUUSD")["coverage"]["has_earnings"] is False


def test_dossier_carries_trades_matched_across_symbol_spellings(pool, knowledge_corpus,
                                                                reference, trading_store):
    """交易库里同一个标的历史上有三种记法，标的页要能都认出来。"""
    account = trading_store.ensure_account(
        "main", initial_balance=1000.0, max_leverage=10.0,
        margin_mode="cross", default_risk_pct=1.0)["id"]
    trading_store.create_trade(account, "NVDA/USDT:USDT", "long", "setup", 2.0)

    d = asset_detail("NVDA")
    assert [t["symbol"] for t in d["trades"]] == ["NVDA/USDT:USDT"]
    assert d["trades"][0]["account"] == "main"
    assert asset_detail("XAUUSD")["trades"] == []


def test_index_still_lists_assets_that_were_only_traded(pool, knowledge_corpus, trading_store):
    """BZ 实测：0 条知识单元、3 笔交易。只按知识单元筛，它在工作台里无处可达。"""
    account = trading_store.ensure_account(
        "main", initial_balance=1000.0, max_leverage=10.0,
        margin_mode="cross", default_risk_pct=1.0)["id"]
    trading_store.create_trade(account, "BZ", "short", "discretionary", 2.0)

    rows = {r["asset"]: r for r in assets_index()["assets"]}
    assert rows["BZ"]["units"] == 0
    assert rows["BZ"]["display"] == "布伦特原油"
    assert "QQQ" not in rows                        # 没交易过的空标的仍然不列
