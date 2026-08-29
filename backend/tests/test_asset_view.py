"""按标的聚合的读模型 + "按标的取单元"过滤器。语料见 conftest 的 knowledge_corpus。"""

from analyzer.knowledge import asset_view
from analyzer.knowledge.browser import browse_units_page

from conftest import FUTURE_LADDER, FUTURE_LADDER_2


# --- 宇宙与汇总 ---------------------------------------------------------------

def test_universe_counts_every_kind_not_just_claims(pool, knowledge_corpus):
    rows = {r["asset"]: r for r in asset_view.asset_universe(pool)}
    nvda = rows["NVDA"]
    assert (nvda["units"], nvda["claims"], nvda["methods"], nvda["concepts"]) == (6, 3, 1, 2)
    assert nvda["creators"] == 2
    assert rows["SOXX"]["units"] == 2          # 一条 method + 一条 concept，都没有 asset_symbol
    assert "AI-CAPEX" not in rows              # 主题标签不得被当成标的


def test_alias_spelling_folds_into_the_canonical_id(pool, knowledge_corpus):
    rows = {r["asset"]: r for r in asset_view.asset_universe(pool)}
    assert "XAU/USD" not in rows
    assert rows["XAUUSD"]["claims"] == 1


def test_hit_rate_excludes_unresolved_outcomes(pool, knowledge_corpus):
    s = asset_view.asset_summary(pool, "NVDA")
    assert (s["scored"], s["hits"], s["misses"], s["partials"]) == (2, 1, 1, 0)
    assert s["unresolved"] == 1                # condition_not_met 不进分母
    assert s["hit_rate"] == 0.5


def test_hit_rate_is_none_without_samples(pool, knowledge_corpus):
    assert asset_view.hit_rate(0, 0, 0) is None
    assert asset_view.asset_summary(pool, "SOXX")["hit_rate"] is None


def test_summary_carries_registry_identity(pool, knowledge_corpus):
    s = asset_view.asset_summary(pool, "xauusd")
    assert s["display"] == "黄金" and s["asset_class"] == "metal"
    assert s["has_bars"] is True and s["has_metrics"] is False


def test_unknown_asset_has_no_summary(pool, knowledge_corpus):
    assert asset_view.asset_summary(pool, "NOSUCH") is None
    assert asset_view.asset_dossier(pool, "NOSUCH") is None


# --- 未到期与已判定 -----------------------------------------------------------

def test_open_claims_come_from_the_frozen_ladder(pool, knowledge_corpus):
    rows = asset_view.open_claims(pool, "NVDA")
    assert [r["horizon_label"] for r in rows] == [FUTURE_LADDER, FUTURE_LADDER_2]
    assert rows[0]["payload"]["scoring_spec"]["success_def"]     # 判据原样带出
    # 汇总数的是**条数**（按 claim 去重），列表给的是**时点**：一条判断可以有多个阶梯日。
    assert asset_view.asset_summary(pool, "NVDA")["open_claims"] == 1


def test_settled_claims_are_newest_first(pool, knowledge_corpus):
    # u1(hit) 与 u5(miss) 同一个 eval_ts，同时点按落库次序倒序 → miss 在前。
    rows = asset_view.settled_claims(pool, "NVDA")
    assert [r["outcome"] for r in rows] == ["miss", "hit", "condition_not_met"]
    assert all(r["creator"] for r in rows)


def test_by_creator_splits_the_record(pool, knowledge_corpus):
    rows = {r["creator"]: r for r in asset_view.by_creator(pool, "NVDA")}
    assert rows["测试信源甲"]["hits"] == 1 and rows["测试信源甲"]["hit_rate"] == 1.0
    assert rows["测试信源乙"]["misses"] == 1 and rows["测试信源乙"]["hit_rate"] == 0.0
    assert rows["测试信源乙"]["units"] == 3


# --- 节点 / 分歧 / 相关标的 ---------------------------------------------------

def test_nodes_and_disagreements_follow_the_asset_tag(pool, knowledge_corpus):
    nodes = asset_view.nodes_for_asset(pool, "NVDA")
    assert [n["title"] for n in nodes] == ["算力定价"]
    d = asset_view.disagreements(pool, "NVDA")
    assert [r["relation"] for r in d["relations"]] == ["conflicts"]
    assert [e["relation"] for e in d["evolution"]] == ["supersedes"]
    assert d["evolution"][0]["creator"] == "测试信源乙"


def test_related_assets_come_from_co_mentions(pool, knowledge_corpus):
    rows = asset_view.related_assets(pool, "NVDA")
    assert [(r["asset"], r["co_mentions"]) for r in rows] == [("SOXX", 1)]
    assert asset_view.related_assets(pool, "XAUUSD") == []


def test_dossier_assembles_the_first_screen(pool, knowledge_corpus):
    d = asset_view.asset_dossier(pool, "nvda")
    assert d["asset"] == "NVDA"
    assert d["identity"]["display"] == "英伟达" and d["identity"]["class_label"] == "个股"
    assert d["coverage"]["bars"] is True and d["coverage"]["instrument"] == "NVDA"
    assert d["summary"]["units"] == 6
    assert len(d["open_claims"]) == 2 and len(d["settled_claims"]) == 3   # 2 个时点 / 1 条判断
    assert len(d["by_creator"]) == 2


# --- "按标的取单元"过滤器 -----------------------------------------------------

def test_unit_filter_matches_tags_not_only_claim_symbols(pool, knowledge_corpus):
    page = browse_units_page(pool, symbol="NVDA")
    assert page["total"] == 6
    assert page["counts"] == {"claim": 3, "method": 1, "concept": 2}


def test_unit_filter_resolves_aliases_and_case(pool, knowledge_corpus):
    for spelling in ("XAUUSD", "xauusd", "XAU/USD", "GOLD"):
        assert browse_units_page(pool, symbol=spelling)["total"] == 1, spelling


def test_unit_filter_still_works_for_unregistered_symbols(pool, knowledge_corpus):
    assert browse_units_page(pool, symbol="NOSUCH")["total"] == 0
