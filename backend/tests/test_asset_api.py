"""/assets 与 /assets/{id} 的契约：形状、覆盖标记、别名、空档案与 404。

直接调端点函数（同 test_keyframe_api 的做法），不起 HTTP 服务；库是 fanisl_test。
"""

import pytest

from analyzer.main import asset_detail, assets_index
from fastapi import HTTPException


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
    assert "QQQ" not in listed                      # 登记了、库里没单元

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
