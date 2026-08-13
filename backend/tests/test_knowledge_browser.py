from datetime import datetime, timedelta, timezone

from analyzer.knowledge.browser import browse_units_page, verification_page, verification_summary
from analyzer.knowledge.models import KnowledgeUnit
from analyzer.knowledge.store import KnowledgeStore


def _concept(index: int) -> KnowledgeUnit:
    return KnowledgeUnit(
        kind="concept",
        quote=f"证据原句 {index}",
        payload={"canonical_statement": f"长期认知 {index}", "category": "other"},
        tags=["paging"],
    )


def test_unit_browser_returns_stable_pages_and_full_counts(pool):
    store = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
            "claim_scores, spot_checks, keyframes RESTART IDENTITY CASCADE"
        )

    creator = store.ensure_creator("分页测试信源")
    base = datetime(2026, 8, 1, tzinfo=timezone.utc)
    expected_ids: list[int] = []
    for index in range(7):
        content_id, _ = store.upsert_content(
            creator,
            platform="manual",
            url=f"https://example.test/page-{index}",
            content_type="article",
            title=f"分页内容 {index}",
            published_at=base + timedelta(days=index),
            raw=f"证据原句 {index}",
        )
        expected_ids.extend(store.record_extraction(
            content_id,
            extractor_version=f"page-v{index}",
            model="test",
            units=[_concept(index)],
        ))

    first = browse_units_page(pool, tag="paging", limit=3, offset=0)
    second = browse_units_page(pool, tag="paging", limit=3, offset=3)
    last = browse_units_page(pool, tag="paging", limit=3, offset=6)

    assert first["total"] == 7
    assert first["counts"] == {"claim": 0, "method": 0, "concept": 7}
    assert first["creator_counts"] == {str(creator): 7}
    assert first["has_more"] and second["has_more"] and not last["has_more"]
    seen = [row["id"] for page in (first, second, last) for row in page["items"]]
    assert seen == list(reversed(expected_ids))
    assert len(seen) == len(set(seen)) == 7


def test_verification_pages_use_uncapped_bucket_counts(pool):
    store = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
            "claim_scores, spot_checks, keyframes RESTART IDENTITY CASCADE"
        )

    creator = store.ensure_creator("验证分页信源")
    content_id, _ = store.upsert_content(
        creator,
        platform="manual",
        url="https://example.test/verification-pages",
        content_type="article",
        title="验证分页",
        published_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        raw="判断会依次评分",
    )
    unit_id = store.record_extraction(
        content_id,
        extractor_version="verification-page-v1",
        model="test",
        units=[KnowledgeUnit(
            kind="claim",
            quote="价格继续上涨",
            payload={
                "asset_text": "测试资产",
                "asset_symbol": "TEST",
                "priceable": True,
                "claim_class": "directional",
                "direction": "up",
                "horizon": {"type": "within_duration", "duration_days": 30},
                "stance_strength": "explicit",
                "verifiability": "A",
                "scoring_spec": {
                    "method": "sign",
                    "eval_ladder": ["30d", "60d", "90d"],
                    "success_def": "收益为正",
                },
            },
        )],
    )[0]
    for index, outcome in enumerate(("hit", "partial", "miss")):
        store.record_score(
            unit_id,
            eval_ts=datetime(2026, 8, index + 2, tzinfo=timezone.utc),
            horizon_label=f"{(index + 1) * 30}d",
            outcome=outcome,
            realized={"asset_ret": index / 10},
            scorer_version="page-v1",
        )

    summary = verification_summary(pool, days=14)
    first = verification_page(pool, bucket="recent", days=14, limit=2, offset=0)
    second = verification_page(pool, bucket="recent", days=14, limit=2, offset=2)
    assert summary["overview"]["completed"] == 3
    assert first["total"] == 3 and first["has_more"]
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert not second["has_more"]
