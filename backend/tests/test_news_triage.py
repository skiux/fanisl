"""动态降噪：确定性规则的判决、"点名就留下"的例外、以及 LLM 失败时不动数据。

规则这半是本文件的重点——它免费、可复现，而且**会误杀就是真误杀**，所以每条规则的
例外都要有用例钉住。LLM 那半只测"调不通时不改任何行"。
"""

import pytest

from analyzer.knowledge import news_triage as nt
from analyzer.knowledge.reference import ReferenceStore


def verdict(title, *, asset="NVDA", source="Benzinga", names=("Nvidia",), cross=1):
    return nt.rule_verdict({"title": title, "source": source},
                           asset=asset, names=names, cross_posts=cross)


def test_pure_churn_sources_are_dropped_whole():
    """ChartMill 那 213 条全是盘面流水，没有一条有信息量。"""
    assert verdict("Most active S&P500 stocks", source="ChartMill") == "noise"
    # 但整源规则优先于"点名"例外——它连点名的那条也不值得看
    assert verdict("Nvidia leads dow jones movers", source="ChartMill") == "noise"


def test_roundups_are_noise_unless_they_name_the_asset():
    assert verdict("What Moved Markets This Week") == "noise"
    assert verdict("Most active S&P500 stocks in Friday's session") == "noise"
    # 点名了就留给 LLM 判——"英伟达重申增长指引"不该被榜单规则误杀
    assert verdict("Warsh Sparks Rate-Hike Bets, Nvidia Reaffirms AI Growth Story") is None


def test_cross_posted_pieces_are_context_not_noise():
    """一稿多投多半是行业/主题稿：对这个标的不是"关于"，但常常是有用的背景。

    一刀切成 noise 会误杀"The Memory Shortage Gets Worse In 2027"——
    存储涨价正是语料里几条判断的论据。
    """
    assert verdict("The Memory Shortage Gets Worse In 2027", cross=9) == "context"
    assert verdict("The Memory Shortage Gets Worse In 2027", cross=2) is None
    # 点名了就不算"泛稿"
    assert verdict("Nvidia's Halo Effect On The Chip Rally", cross=9) is None


def test_ticker_and_company_name_both_count_as_naming():
    assert verdict("NVDA options flow turns bullish", cross=9) is None
    assert verdict("Nvidia beats on data centre revenue", cross=9) is None
    # 只是别家公司被点名，不算
    assert verdict("Broadcom Stock Faces Valuation Test", cross=9) == "context"


def test_parse_json_tolerates_fences_and_chatter():
    assert nt._parse_json('```json\n{"items":[{"i":0}]}\n```') == {"items": [{"i": 0}]}
    assert nt._parse_json('好的：{"items":[]} 以上') == {"items": []}
    assert nt._parse_json("没有 JSON") is None


@pytest.fixture
def store(pool):
    st = ReferenceStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE asset_profiles, news_items, asset_events RESTART IDENTITY")
    return st


def _news(title, url, *, source="Benzinga"):
    return {"published_at": "2026-08-20T09:00:00+00:00", "title": title, "summary": None,
            "url": url, "source": source, "provider": "finnhub", "image_url": None}


def test_rules_only_touch_unclassified_rows(store, pool):
    store.add_news("NVDA", [
        _news("Most active S&P500 stocks", "https://example.test/1"),
        _news("Nvidia beats on data centre revenue", "https://example.test/2"),
    ])
    first = nt.apply_rules(pool, only="NVDA")
    assert first == {"seen": 2, "marked": 1, "left": 1}
    # 再跑一遍：已判的不再看，未判的仍然未判（等 LLM）
    assert nt.apply_rules(pool, only="NVDA") == {"seen": 1, "marked": 0, "left": 1}


def test_noise_is_hidden_from_the_page_but_never_deleted(store, pool):
    store.add_news("NVDA", [
        _news("Most active S&P500 stocks", "https://example.test/1"),
        _news("Nvidia beats on data centre revenue", "https://example.test/2"),
    ])
    nt.apply_rules(pool, only="NVDA")

    shown = [row["title"] for row in store.news("NVDA")]
    assert shown == ["Nvidia beats on data centre revenue"]
    assert len(store.news("NVDA", include=())) == 2        # 原始记录还在
    assert store.news_counts("NVDA") == {"noise": 1, "unclassified": 1}
    assert store.news_coverage_for("NVDA")["noise"] == 1


def test_a_broken_llm_leaves_rows_untouched(store, pool, monkeypatch):
    """调不通就留 NULL——页面照常显示未判的，不会因为模型挂了变空。"""
    store.add_news("NVDA", [_news("Nvidia beats on data centre revenue", "https://example.test/2")])

    def boom(*_args, **_kwargs):
        raise RuntimeError("额度已用尽")

    monkeypatch.setattr(nt, "_call_llm", boom)

    class _S:
        news_triage_backend = "claude"
        news_triage_pace_s = 0.0

    assert nt.classify_with_llm(pool, _S(), asset="NVDA") == {
        "seen": 1, "classified": 0, "failed_batches": 1}
    assert store.news("NVDA")[0]["relevance"] is None
