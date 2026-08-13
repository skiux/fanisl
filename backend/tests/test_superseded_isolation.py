"""重转录旧稿（contents.status='superseded'）不得混进任何"有几期内容"的计数。

这是回归测试而不是静态检查：superseded 是后加的状态，当初漏改的那几处查询（周报、
内容列表、提帧选取）都是"写的时候还没有这个状态"。常量 LIVE_CONTENT 只能让人看见，
拦不住下一个忘记的人——能拦住的是这里：任何新写的枚举查询只要漏了过滤，下面就红。

同时锁住反向约束：**去重前置闸必须看得见旧稿**，否则同一个视频会被反复付费转录。
"""

from datetime import datetime, timezone

import pytest

from analyzer.knowledge.models import KnowledgeUnit
from analyzer.knowledge.store import KnowledgeStore


@pytest.fixture
def store(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, "
                     "knowledge_units, claim_scores, spot_checks, keyframes "
                     "RESTART IDENTITY CASCADE")
    return st


@pytest.fixture
def two_versions(store):
    """同一个视频的两稿：旧稿被取代，新稿生效。"""
    cid = store.ensure_creator("重转录信源")
    url = "https://www.youtube.com/watch?v=aaaaaaaaaaa"
    ts = datetime(2026, 7, 20, tzinfo=timezone.utc)
    old_id, _ = store.upsert_content(cid, platform="youtube", url=url, content_type="video",
                                     title="1458期", published_at=ts, raw="旧稿：转录被截断了")
    new_id, _ = store.upsert_content(cid, platform="youtube", url=url, content_type="video",
                                     title="1458期", published_at=ts, raw="新稿：完整转录内容")
    unit = KnowledgeUnit(kind="concept", quote="完整转录内容",
                         payload={"canonical_statement": "一条认知", "category": "regime"})
    store.record_extraction(old_id, extractor_version="pending-v1", model="m", units=[unit])
    store.record_extraction(new_id, extractor_version="pending-v1", model="m", units=[unit])
    with store.pool.connection() as conn:
        conn.execute("UPDATE contents SET status='superseded' WHERE id=%s", (old_id,))
    return store, old_id, new_id


def test_content_list_counts_each_episode_once(two_versions):
    """前端曾把投资TALK君显示成 23 期（实为 20 期），根因就是这里。"""
    store, old_id, _ = two_versions
    rows = store.list_contents()
    assert len(rows) == 1
    assert old_id not in {r["id"] for r in rows}


def test_superseded_still_reachable_when_asked_for_explicitly(two_versions):
    """旧稿是 L0 的历史记录，不删也不该藏——只是不进默认计数。"""
    store, old_id, _ = two_versions
    rows = store.list_contents(status="superseded")
    assert [r["id"] for r in rows] == [old_id]


def test_weekly_report_increment_excludes_superseded(two_versions, tmp_path, monkeypatch):
    import analyzer.knowledge.discovery as disc

    # weekly_report 会把 markdown 落到全局 REPORT_DIR——那是仓库里被追踪的
    # data_export/reports/，不改道的话跑一次测试就会用夹具数据覆盖掉真实周报。
    monkeypatch.setattr(disc, "REPORT_DIR", tmp_path)

    store, _, _ = two_versions
    summary = disc.weekly_report(store.pool, days=3650)["summary"]
    assert sum(r["n"] for r in summary["new_contents"]) == 1


def test_keyframe_backfill_skips_superseded(two_versions):
    from analyzer.knowledge.backfill_keyframes import _select_contents

    store, old_id, new_id = two_versions
    picked = {c["id"] for c in _select_contents(store, handle=None, content_id=None, limit=None)}
    assert picked == {new_id}
    # 点名某条时照抓——补漏不该被状态挡住
    named = _select_contents(store, handle=None, content_id=old_id, limit=None)
    assert [c["id"] for c in named] == [old_id]


def test_dedup_gate_must_still_see_superseded(two_versions):
    """反向约束：URL 去重闸看不见旧稿的话，同一个视频会被反复付费转录。"""
    store, _, _ = two_versions
    assert store.content_url_exists("https://www.youtube.com/watch?v=aaaaaaaaaaa")


def test_dedup_by_raw_hash_still_sees_superseded(store):
    """同理，raw 哈希去重也必须命中旧稿，否则重跑会插出一堆同文副本。"""
    cid = store.ensure_creator("哈希去重信源")
    ts = datetime(2026, 7, 20, tzinfo=timezone.utc)
    first, created = store.upsert_content(cid, platform="youtube", url="https://y/x",
                                          content_type="video", title="t",
                                          published_at=ts, raw="一模一样的原文")
    assert created
    with store.pool.connection() as conn:
        conn.execute("UPDATE contents SET status='superseded' WHERE id=%s", (first,))
    again, created2 = store.upsert_content(cid, platform="youtube", url="https://y/x2",
                                           content_type="video", title="t2",
                                           published_at=ts, raw="一模一样的原文")
    assert again == first and not created2
