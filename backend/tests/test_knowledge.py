"""知识引擎 K0：schema 往返 / 载荷校验 / 幂等与版本化重放。"""

import pytest
from datetime import datetime, timezone

from analyzer.knowledge.models import ClaimPayload, KnowledgeUnit
from analyzer.knowledge.store import KnowledgeStore


@pytest.fixture
def kstore(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, "
                     "knowledge_units, claim_scores, spot_checks RESTART IDENTITY CASCADE")
    return st


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


def test_claim_payload_validation_gates():
    ClaimPayload.model_validate(_claim())                       # A 级 + spec 合法
    with pytest.raises(ValueError):                             # A/B/C 缺 spec 拒绝
        ClaimPayload.model_validate(_claim(scoring_spec=None))
    with pytest.raises(ValueError):                             # D 级带 spec 拒绝
        ClaimPayload.model_validate(_claim(verifiability="D"))
    with pytest.raises(ValueError):                             # A 级不可定价拒绝
        ClaimPayload.model_validate(_claim(priceable=False))
    ClaimPayload.model_validate(_claim(verifiability="D", scoring_spec=None))  # D 级合法


def test_store_roundtrip_and_replay(kstore):
    cid = kstore.ensure_creator("测试创作者", focus="能源")
    kstore.ensure_handle(cid, "youtube", "@test", "https://youtube.com/@test")
    kstore.ensure_handle(cid, "youtube", "@test")               # 幂等
    assert len(kstore.creators()) == 1

    ts = datetime(2026, 7, 1, tzinfo=timezone.utc)
    content_id, created = kstore.upsert_content(
        cid, platform="youtube", url="https://y/t1", content_type="video",
        title="本周原油", published_at=ts, raw="原油会去测 75……", lang="zh")
    assert created
    _, created2 = kstore.upsert_content(                        # 同文去重
        cid, platform="youtube", url="https://y/t1-dup", content_type="video",
        title="转载", published_at=ts, raw="原油会去测 75……")
    assert not created2

    unit = KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=_claim())
    ids = kstore.record_extraction(content_id, extractor_version="v1", model="m",
                                   units=[unit], ref_prices={0: 68.4})
    assert len(ids) == 1
    assert kstore.get_content(content_id)["status"] == "extracted"
    got = kstore.units(kind="claim")[0]
    assert got["ref_price_at_publish"] == 68.4
    assert got["payload"]["scoring_spec"]["method"] == "target_touch"
    # 同版本重跑必须报错（换版本号才能重放）
    with pytest.raises(Exception):
        kstore.record_extraction(content_id, extractor_version="v1", model="m", units=[unit])
    ids2 = kstore.record_extraction(content_id, extractor_version="v2", model="m", units=[unit])
    assert len(kstore.units(kind="claim")) == 2 and ids2 != ids
