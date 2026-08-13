from datetime import datetime, timezone

from analyzer.knowledge.models import KnowledgeUnit
from analyzer.knowledge.nodes import NodeStore
from analyzer.knowledge.overview import overview_stats
from analyzer.knowledge.store import KnowledgeStore


def test_overview_is_not_capped_and_excludes_superseded_content(pool):
    store = KnowledgeStore(pool)
    nodes = NodeStore(pool)
    with pool.connection() as conn:
        conn.execute(
            "TRUNCATE node_relations, node_attestations, knowledge_nodes, creators, "
            "creator_handles, contents, extraction_runs, knowledge_units, claim_scores, "
            "spot_checks, keyframes RESTART IDENTITY CASCADE"
        )

    creator = store.ensure_creator("汇总测试信源")
    published_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    current_id, _ = store.upsert_content(
        creator,
        platform="manual",
        url="https://example.test/current",
        content_type="article",
        title="当前内容",
        published_at=published_at,
        raw="趋势方法与价格判断",
    )
    current_units = store.record_extraction(
        current_id,
        extractor_version="overview-v1",
        model="test",
        units=[
            KnowledgeUnit(
                kind="claim",
                quote="价格将上涨",
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
                        "eval_ladder": ["30d"],
                        "success_def": "收益为正",
                    },
                },
            ),
            KnowledgeUnit(
                kind="method",
                quote="使用趋势方法",
                payload={
                    "name": "趋势方法",
                    "summary": "跟随趋势",
                    "family": "trend",
                    "rules": ["顺势"],
                    "testability": "B",
                },
            ),
        ],
    )

    old_id, _ = store.upsert_content(
        creator,
        platform="manual",
        url="https://example.test/old",
        content_type="article",
        title="旧稿",
        published_at=published_at,
        raw="已被重转录替代的认知",
    )
    store.record_extraction(
        old_id,
        extractor_version="overview-v1",
        model="test",
        units=[KnowledgeUnit(
            kind="concept",
            quote="旧认知",
            payload={"canonical_statement": "旧认知", "category": "other"},
        )],
    )
    store.set_status(old_id, "superseded")

    nodes.import_nodes({
        "merger_version": "overview-v1",
        "nodes": [{
            "kind": "method",
            "title": "趋势方法",
            "canonical": "跟随趋势",
            "units": [{"id": current_units[1]}],
        }],
    })

    assert overview_stats(pool) == {
        "contents": 1,
        "units": 2,
        "claims": 1,
        "methods": 1,
        "concepts": 0,
        "nodes": 1,
        "corroborated": 0,
        "creators": 1,
    }
