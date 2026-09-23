"""单元核查：状态流转、答复闸门、修改留痕与评分字段保护。"""

from datetime import datetime, timezone

import pytest

from fanisl.knowledge.models import KnowledgeUnit
from fanisl.knowledge.store import KnowledgeStore, ReviewConflict

RAW = "大家好。原油会去测 75，然后我们不要择时。"


def _claim(**over):
    base = dict(
        asset_text="原油", asset_symbol="CL", priceable=True, claim_class="price_target",
        direction="up", magnitude={"target": 75}, horizon={"type": "by_date", "deadline": "2026-08-31"},
        stance_strength="hedged", verifiability="A",
        scoring_spec={"method": "target_touch", "eval_ladder": ["2026-08-31"],
                      "success_def": "截止日前任意日高点≥75"},
    )
    base.update(over)
    return base


@pytest.fixture
def ks(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
                     "claim_scores, spot_checks, keyframes, unit_reviews, unit_review_messages, "
                     "unit_amendments RESTART IDENTITY CASCADE")
    return st


@pytest.fixture
def unit_id(ks):
    cid = ks.ensure_creator("测试创作者")
    content_id, _ = ks.upsert_content(
        cid, platform="youtube", url="https://y/review", content_type="video", title="t",
        published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw=RAW)
    unit = KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=_claim())
    return ks.record_extraction(content_id, extractor_version="v2", model="m", units=[unit])[0]


def test_review_lifecycle(ks, unit_id):
    r = ks.create_review(unit_id, category="grade", body="这条应该是 B 不是 A", author="mur")
    assert r["status"] == "open" and [m["role"] for m in r["messages"]] == ["reviewer"]
    r = ks.add_review_message(r["id"], body="补充：期限词不在原文里", author="mur")
    assert r["status"] == "open" and len(r["messages"]) == 2

    r = ks.answer_review(r["id"], body="维持 A：期限是原文自带的『年底』", outcome="no_change",
                         author="claude-session")
    assert r["status"] == "answered"
    assert r["messages"][-1]["role"] == "extractor"
    assert r["messages"][-1]["resolution"]["outcome"] == "no_change"
    assert ks.list_reviews(status="open") == []

    # 用户不同意 → 重新打开，回到知识席位的待办
    r = ks.add_review_message(r["id"], body="原文说的是『今年』，不是『年底』", author="mur")
    assert r["status"] == "open"
    assert [x["id"] for x in ks.list_reviews(status="open")] == [r["id"]]

    r = ks.close_review(r["id"])
    assert r["status"] == "closed" and r["closed_at"] is not None
    assert [x["id"] for x in ks.reviews_for_unit(unit_id)] == [r["id"]]


def test_review_input_and_state_gates(ks, unit_id):
    with pytest.raises(ValueError):
        ks.create_review(unit_id, category="nonsense", body="x", author="mur")
    with pytest.raises(ValueError):
        ks.create_review(unit_id, category="quote", body="   ", author="mur")
    with pytest.raises(ValueError):
        ks.create_review(unit_id, category="quote", body="长" * 4001, author="mur")
    with pytest.raises(LookupError):
        ks.create_review(999999, category="quote", body="x", author="mur")
    with pytest.raises(ValueError):
        ks.list_reviews(status="pending")

    r = ks.create_review(unit_id, category="quote", body="断章取义", author="mur")
    with pytest.raises(ValueError):
        ks.answer_review(r["id"], body="x", outcome="maybe", author="c")
    with pytest.raises(ValueError, match="root_cause"):          # fixed 必须复盘
        ks.answer_review(r["id"], body="已改", outcome="fixed", author="c", sweep="查了同期 12 条")
    with pytest.raises(ReviewConflict, match="修改记录"):         # fixed 必须真的改过
        ks.answer_review(r["id"], body="已改", outcome="fixed", author="c",
                         root_cause="quote 截短时丢了否定词", sweep="查了同期 12 条，无同类")
    assert ks.review_detail(r["id"])["status"] == "open"          # 被拒的答复不留痕

    ks.answer_review(r["id"], body="需要你指出是哪一句", outcome="needs_info", author="c")
    with pytest.raises(ReviewConflict):                            # 只能答复 open 的
        ks.answer_review(r["id"], body="再答一次", outcome="no_change", author="c")
    ks.close_review(r["id"])
    with pytest.raises(ReviewConflict):
        ks.close_review(r["id"])
    with pytest.raises(LookupError):
        ks.close_review(999999)


def test_amend_then_answer_fixed(ks, unit_id):
    r = ks.create_review(unit_id, category="statement", body="asset_text 与原文不符", author="mur")
    a = ks.amend_unit(unit_id, payload=_claim(asset_text="WTI 原油"), reason="标的表述对齐原文",
                      author="claude-session", review_id=r["id"])
    assert a["changed"] == ["payload.asset_text"]
    assert a["before"]["payload"]["asset_text"] == "原油"
    assert ks.unit_detail(unit_id)["payload"]["asset_text"] == "WTI 原油"

    r = ks.answer_review(r["id"], body="已改", outcome="fixed", author="claude-session",
                         root_cause="asset_text 沿用了上一期的写法",
                         sweep="同期 claim 共 1 条，已全部核对", followup=None)
    assert r["status"] == "answered"
    assert [x["changed"] for x in r["amendments"]] == [["payload.asset_text"]]
    assert r["messages"][-1]["resolution"] == {
        "outcome": "fixed", "root_cause": "asset_text 沿用了上一期的写法",
        "sweep": "同期 claim 共 1 条，已全部核对", "followup": None}


def test_amend_gates(ks, unit_id, pool):
    with pytest.raises(ValueError, match="原文"):                 # quote 必须逐字出自原文
        ks.amend_unit(unit_id, quote="原油会去测 80", reason="x", author="c")
    with pytest.raises(ValueError):                              # A 级必须带 spec
        ks.amend_unit(unit_id, payload=_claim(scoring_spec=None), reason="x", author="c")
    with pytest.raises(ValueError):
        ks.amend_unit(unit_id, reason="   ", tags=["wti"], author="c")
    with pytest.raises(ValueError, match="相同"):
        ks.amend_unit(unit_id, payload=_claim(), reason="x", author="c")
    other = ks.create_review(unit_id, category="quote", body="x", author="mur")
    with pytest.raises(ValueError, match="不是针对"):
        ks.amend_unit(unit_id, tags=["wti"], reason="x", author="c", review_id=other["id"] + 1)
    assert ks.unit_detail(unit_id)["payload"]["verifiability"] == "A"   # 失败不留半截

    # 已有评分：评分相关字段不许改，其它字段照常
    ks.record_score(unit_id, eval_ts=datetime.now(timezone.utc), horizon_label="2026-08-31",
                    outcome="hit", realized={}, scorer_version="t")
    with pytest.raises(ReviewConflict, match="评分"):
        ks.amend_unit(unit_id, payload=_claim(magnitude={"target": 80}), reason="x", author="c")
    ks.amend_unit(unit_id, tags=["wti", "oil-supply"], reason="补标签", author="c")
    assert ks.unit_detail(unit_id)["tags"] == ["wti", "oil-supply"]
    with pool.connection() as conn:
        assert conn.execute("SELECT count(*) AS n FROM unit_amendments").fetchone()["n"] == 1


def test_review_cli_end_to_end(ks, unit_id, pool, monkeypatch, capsys, tmp_path):
    """CLI 接线：argparse → store → 输出；被拒走一行「拒绝：…」而不是栈回溯。连的是测试库。"""
    import json
    import sys
    from types import SimpleNamespace

    from fanisl.knowledge import review

    monkeypatch.setattr(review, "get_settings", lambda: SimpleNamespace(pg_knowledge_conninfo=pool.conninfo))

    def cli(*argv):
        monkeypatch.setattr(sys, "argv", ["review", *map(str, argv)])
        review.main()
        return capsys.readouterr().out

    r = ks.create_review(unit_id, category="statement", body="asset_text 与原文不符", author="mur")
    assert f"#{r['id']}" in cli("list")
    with pytest.raises(SystemExit, match="修改记录"):
        cli("answer", r["id"], "--outcome", "fixed", "--body", "已改", "--root-cause", "x", "--sweep", "y")

    payload_file = tmp_path / "payload.json"
    payload_file.write_text(json.dumps(_claim(asset_text="WTI 原油"), ensure_ascii=False))
    assert "payload.asset_text" in cli("amend", unit_id, "--review", r["id"],
                                       "--payload-file", payload_file, "--reason", "对齐原文")
    assert "answered" in cli("answer", r["id"], "--outcome", "fixed", "--body", "已改",
                             "--root-cause", "沿用了上一期的写法", "--sweep", "同期 1 条已核")
    with pytest.raises(SystemExit, match="只能答复 open"):   # 冲突同样是一行拒绝
        cli("answer", r["id"], "--outcome", "no_change", "--body", "再答")

    out = cli("show", r["id"])
    assert "[extractor]" in out and "WTI 原油" in out and "沿用了上一期的写法" in out


def test_void_score_keeps_the_row_and_blocks_rescoring(ks, unit_id):
    """作废 = 整行搬进 claim_score_voids；统计不再计它，评分器也不会把这个时点评回来。"""
    ks.record_score(unit_id, eval_ts=datetime(2026, 9, 1, tzinfo=timezone.utc), horizon_label="2026-08-31",
                    outcome="hit", realized={"ref": 70.0}, scorer_version="v1")
    with pytest.raises(ValueError, match="reason"):
        ks.void_score(unit_id, "2026-08-31", reason=" ", author="claude-session")
    with pytest.raises(LookupError):
        ks.void_score(unit_id, "2026-09-30", reason="不存在的时点", author="claude-session")

    v = ks.void_score(unit_id, "2026-08-31", reason="期限应为 2 天，此阶梯不该存在", author="claude-session")
    assert v["score"]["outcome"] == "hit" and v["score"]["realized"] == {"ref": 70.0}
    with ks.pool.connection() as conn:
        assert conn.execute("SELECT count(*) AS n FROM claim_scores").fetchone()["n"] == 0
    assert ks.score_exists(unit_id, "2026-08-31", "v1")          # 评分器会跳过它
    assert [x["horizon_label"] for x in ks.score_voids(unit_id)] == ["2026-08-31"]
    with pytest.raises(LookupError):                               # 不能作废两次
        ks.void_score(unit_id, "2026-08-31", reason="再来一次", author="claude-session")

    # 作废过也算评过：评分字段仍然锁定，不能先作废再改判据
    with pytest.raises(ReviewConflict):
        ks.amend_unit(unit_id, reason="改期限", author="claude-session",
                      payload=_claim(horizon={"type": "by_date", "deadline": "2026-09-30"},
                                     scoring_spec={"method": "target_touch", "eval_ladder": ["2026-09-30"],
                                                   "success_def": "截止日前任意日高点≥75"}))


def test_void_for_rescore_lets_the_scorer_score_again(ks, unit_id):
    """配置漏了条件、评分没按冻结的判据执行：原行留档，时点放回给评分器重评。"""
    ks.record_score(unit_id, eval_ts=datetime(2026, 9, 1, tzinfo=timezone.utc), horizon_label="2026-08-31",
                    outcome="hit", realized={}, scorer_version="v1")
    ks.void_score(unit_id, "2026-08-31", reason="漏了前置条件，重评", author="claude-session", rescore=True)
    assert not ks.score_exists(unit_id, "2026-08-31", "v1")
    ks.record_score(unit_id, eval_ts=datetime(2026, 9, 2, tzinfo=timezone.utc), horizon_label="2026-08-31",
                    outcome="condition_not_met", realized={}, scorer_version="v1")
    assert ks.score_exists(unit_id, "2026-08-31", "v1")
    # 重评出来的这一条日后也还能作废（同一时点可以有多条作废记录）
    ks.void_score(unit_id, "2026-08-31", reason="再作废", author="claude-session")
    assert [v["rescore"] for v in ks.score_voids(unit_id)] == [True, False]
