"""知识引擎 K0：schema 往返 / 载荷校验 / 幂等与版本化重放。"""

import pathlib
import sys

import pytest
from datetime import datetime, timezone

from analyzer.knowledge.models import ClaimPayload, KnowledgeUnit
from analyzer.knowledge.store import KnowledgeStore


@pytest.fixture
def kstore(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, "
                     "knowledge_units, claim_scores, spot_checks, keyframes "
                     "RESTART IDENTITY CASCADE")
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
    # 列表视图：带信源名/字数/单元数，不含 raw 全文
    rows = kstore.list_contents()
    assert rows[0]["creator"] == "测试创作者" and rows[0]["n_units"] == 2
    assert rows[0]["raw_len"] > 0 and "raw" not in rows[0]


def test_verification_views_keep_due_and_scored_records_distinct(kstore):
    creator = kstore.ensure_creator("验证信源")
    content_id, _ = kstore.upsert_content(
        creator, platform="manual", url="https://example.test/verification", content_type="article",
        title="验证样本", published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw="原油判断")
    ids = kstore.record_extraction(content_id, extractor_version="v1", model="m", units=[
        KnowledgeUnit(kind="claim", quote="原油触及 75", payload=_claim(
            scoring_spec={"method": "target_touch", "eval_ladder": ["2026-07-18"], "success_def": "高点达到 75"},
        )),
    ], ref_prices={0: 70.0})
    kstore.record_score(ids[0], eval_ts=datetime(2026, 7, 18, tzinfo=timezone.utc),
                        horizon_label="2026-07-18", outcome="hit",
                        realized={"ref": 70, "eval_close": 76, "high": 76}, scorer_version="v1")
    queue = kstore.verification_queue(days=365)
    assert queue["recent"][0]["outcome"] == "hit"
    detail = kstore.verification_detail(queue["recent"][0]["score_id"])
    assert detail and detail["quote"] == "原油触及 75"
    assert detail["payload"]["scoring_spec"]["method"] == "target_touch"


# --- K3：单元导入（PendingBackend 入库端）------------------------------------

def test_import_units_parse_and_quote_check():
    from analyzer.knowledge.import_units import check_quotes, parse_units_doc
    doc = {
        "content_id": 7, "extractor_version": "pending-v1", "model": "claude-session",
        "units": [
            {"kind": "claim", "quote": "原油会去测 75", "locator": "03:15",
             "ref_price": 68.4, "tags": ["wti"], "payload": _claim()},
            {"kind": "concept", "quote": "不要择时", "tags": ["risk-mgmt"],
             "payload": {"canonical_statement": "不建议择时", "category": "execution"}},
        ],
    }
    content_id, ver, model, units, ref_prices = parse_units_doc(doc)
    assert (content_id, ver, model) == (7, "pending-v1", "claude-session")
    assert len(units) == 2 and ref_prices == {0: 68.4}
    # quote 空白归一后仍须命中原文；未命中的返回下标
    raw = "大家好。原油会去测\n75，然后我们不要择时。"
    assert check_quotes(raw, units) == []
    assert check_quotes("完全无关的文本", units) == [0, 1]
    # 载荷不合法 → 整文件拒绝
    bad = {**doc, "units": [{"kind": "claim", "quote": "q",
                             "payload": _claim(scoring_spec=None)}]}
    with pytest.raises(ValueError, match="units\\[0\\]"):
        parse_units_doc(bad)


# --- K4：评分器（到期机械评分）------------------------------------------------

def _unit(payload_over: dict, *, uid=99999, ref=70.0, pub=datetime(2026, 7, 1, tzinfo=timezone.utc)):
    payload = {
        "asset_symbol": "WTI", "direction": "up", "magnitude": None,
        "scoring_spec": {"method": "sign", "eval_ladder": ["2026-07-08"],
                         "benchmark": None, "success_def": "t"},
    }
    payload.update(payload_over)
    return {"id": uid, "payload": payload, "published_at": pub, "ref_price_at_publish": ref}


def test_scorers_all_methods(pool, monkeypatch):
    import datetime as dt
    from analyzer.knowledge import scorers
    from analyzer.knowledge.prices import PriceStore
    ps = PriceStore(pool)
    with pool.connection() as conn:
        conn.execute("DELETE FROM daily_bars WHERE symbol IN ('WTI','SPX')")
    bars = [  # (ts, o, h, l, c)；7/1=发布日基准（relative 的起点腿）
        (dt.date(2026, 7, 1), 70, 70, 70, 70),
        (dt.date(2026, 7, 2), 70, 74, 70, 73),
        (dt.date(2026, 7, 3), 73, 75, 72, 74),
        (dt.date(2026, 7, 6), 74, 76, 67, 68),
        (dt.date(2026, 7, 7), 68, 69, 66, 66.5),
        (dt.date(2026, 7, 8), 66, 72, 66, 71),
    ]
    ps.upsert("WTI", bars, "test")
    ps.upsert("SPX", [(t, o * 100, h * 100, l * 100, c * 100) for t, o, h, l, c in bars], "test")
    L = dt.date(2026, 7, 8)

    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "hit"                       # sign up: 71≥70
    assert scorers.score_unit_at(ps, _unit({"direction": "down"}), L)[0] == "miss"
    assert scorers.score_unit_at(ps, _unit({"direction": "flat"}), L)[0] == "hit"    # |71/70-1|<2%… 1.4%
    assert scorers.score_unit_at(
        ps, _unit({"scoring_spec": {"method": "target_touch", "eval_ladder": ["2026-07-08"],
                                    "benchmark": None, "success_def": "t"},
                   "magnitude": {"target": 75}}), L)[0] == "hit"                     # 7/3 high 75
    assert scorers.score_unit_at(
        ps, _unit({"scoring_spec": {"method": "range_hold", "eval_ladder": ["2026-07-08"],
                                    "benchmark": None, "success_def": "t"},
                   "direction": "range", "magnitude": {"low": 68}}), L)[0] == "miss"  # 7/7 close 66.5<68
    assert scorers.score_unit_at(
        ps, _unit({"scoring_spec": {"method": "range_hold", "eval_ladder": ["2026-07-08"],
                                    "benchmark": None, "success_def": "t"},
                   "direction": "range", "magnitude": {"low": 66.2}}), L)[0] == "partial"  # 盘中破 66.2 收回
    # 条件类：收盘<69 首次于 7/6 成立（close 68），此后 vs 条件日收盘
    monkeypatch.setitem(scorers.OVERRIDES, "99999",
                        {"condition": {"type": "close_below", "level": 69}, "vs": "condition_close"})
    out, real = scorers.score_unit_at(ps, _unit({}), L)
    assert out == "hit" and real["cond_date"] == "2026-07-06" and real["ref"] == 68
    monkeypatch.delitem(scorers.OVERRIDES, "99999")
    # relative：WTI 与 SPX 同步涨（等比）→ diff=0，up 不 hit，flat hit
    rel = {"scoring_spec": {"method": "relative_return", "eval_ladder": ["2026-07-08"],
                            "benchmark": "SPX", "success_def": "t"}}
    assert scorers.score_unit_at(ps, _unit(rel), L)[0] == "miss"
    assert scorers.score_unit_at(ps, _unit({**rel, "direction": "flat"}), L)[0] == "hit"
    # 未到期与不可定价
    assert scorers.score_unit_at(ps, _unit({}), dt.date(2026, 7, 20)) is None
    assert scorers.score_unit_at(ps, _unit({"asset_symbol": "NOPE"}), L)[0] == "unpriceable"


# --- K5：归并层（节点/提及/生命周期）------------------------------------------

def _seed_units(kstore, n=3):
    cid = kstore.ensure_creator("测试创作者", focus="能源")
    ids = []
    for i in range(n):
        content_id, _ = kstore.upsert_content(
            cid, platform="youtube", url=f"https://y/n{i}", content_type="video",
            title=f"第{i}期", published_at=datetime(2026, 7, 1 + i, tzinfo=timezone.utc),
            raw=f"原油会去测 75……第{i}期")
        unit = KnowledgeUnit(kind="concept", quote="原油会去测 75",
                             payload={"canonical_statement": "供给驱动油价", "category": "macro_framework"})
        ids += kstore.record_extraction(content_id, extractor_version=f"v{i}", model="m", units=[unit])
    return ids


def test_nodes_import_gates_and_lifecycle(kstore, pool):
    from analyzer.knowledge.nodes import NodeStore
    with pool.connection() as conn:
        conn.execute("DROP TABLE IF EXISTS node_attestations, knowledge_nodes CASCADE")
    ns = NodeStore(pool)
    u1, u2, u3 = _seed_units(kstore, 3)

    doc = {"merger_version": "merge-v1", "nodes": [{
        "kind": "concept", "title": "供给驱动油价", "canonical": "油价由供给侧主导",
        "tags": ["wti"], "units": [{"id": u1}, {"id": u2, "relation": "restates"}]}]}
    nid = ns.import_nodes(doc)[0]
    # 两条提及来自不同内容 → corroborated
    ns.recompute()
    assert ns.get_node(nid)["status"] == "corroborated"
    assert len(ns.get_node(nid)["attestations"]) == 2

    # 单元已占用 → 整文件拒绝
    with pytest.raises(ValueError, match="已归属"):
        ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
            "kind": "concept", "title": "x", "canonical": "x", "units": [{"id": u1}]}]})
    # kind 不一致 → 拒绝
    with pytest.raises(ValueError, match="kind 不一致"):
        ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
            "kind": "method", "title": "x", "canonical": "x", "units": [{"id": u3}]}]})

    # contradicts → contested；retire 后重算不覆盖
    ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
        "kind": "concept", "title": "y", "canonical": "y",
        "units": [{"id": u3, "relation": "contradicts"}]}]})
    ns.recompute()
    rows = ns.list_nodes(kind="concept")
    st = {r["title"]: r["status"] for r in rows}
    assert st["y"] == "contested"
    ns.retire(nid, "测试退役")
    ns.recompute()
    assert ns.get_node(nid)["status"] == "retired"

    # 单例种子：为剩余未挂的 method/concept 机械建节点（claim 不建）
    u4 = kstore.record_extraction(
        kstore.upsert_content(kstore.ensure_creator("测试创作者"), platform="youtube",
                              url="https://y/n9", content_type="video", title="第9期",
                              published_at=datetime(2026, 7, 9, tzinfo=timezone.utc),
                              raw="用隧道防守")[0],
        extractor_version="v9", model="m",
        units=[KnowledgeUnit(kind="method", quote="用隧道防守", payload={
            "name": "隧道防守", "summary": "以隧道位防守", "family": "trend",
            "rules": ["破隧道离场"], "testability": "B"})])[0]
    assert ns.seed_singletons(merger_version="merge-v1") == 1
    got = [r for r in ns.list_nodes(kind="method") if r["title"] == "隧道防守"]
    assert len(got) == 1 and ns.seed_singletons(merger_version="merge-v1") == 0
    assert u4 is not None


# --- K6：发现层（关系边/harness 候选/周报/抽查）-------------------------------

def test_discovery_layer(kstore, pool, tmp_path, monkeypatch):
    from analyzer.knowledge import discovery, spotcheck
    from analyzer.knowledge.nodes import NodeStore
    with pool.connection() as conn:
        conn.execute("DROP TABLE IF EXISTS node_relations, node_attestations, knowledge_nodes CASCADE")
        conn.execute("TRUNCATE spot_checks")
    ns = NodeStore(pool)
    u1, u2, _u3 = _seed_units(kstore, 3)
    n1, n2 = ns.import_nodes({"merger_version": "merge-v1", "nodes": [
        {"kind": "concept", "title": "甲", "canonical": "甲论", "units": [{"id": u1}]},
        {"kind": "concept", "title": "乙", "canonical": "乙论", "units": [{"id": u2}]}]})

    # 关系边校验：note 必填 / 自环拒绝 / (a,b) 归一去重
    with pytest.raises(ValueError, match="note"):
        ns.import_relations({"merger_version": "merge-v1", "relations": [
            {"a": n1, "b": n2, "relation": "conflicts"}]})
    with pytest.raises(ValueError, match="自环"):
        ns.import_relations({"merger_version": "merge-v1", "relations": [
            {"a": n1, "b": n1, "relation": "relates", "note": "x"}]})
    ns.import_relations({"merger_version": "merge-v1", "relations": [
        {"a": n2, "b": n1, "relation": "conflicts", "note": "对立点"}]})
    ns.import_relations({"merger_version": "merge-v1", "relations": [
        {"a": n1, "b": n2, "relation": "conflicts", "note": "重复方向应去重"}]})
    edges = ns.list_relations(relation="conflicts")
    assert len(edges) == 1 and edges[0]["a_id"] == min(n1, n2)
    assert ns.relations_for(n1)[0]["other_id"] == n2
    assert ns.get_node(n1)["relations"][0]["other_title"] == "乙"

    # harness 候选：仅 testability=A 的 method 节点入选
    cid = kstore.ensure_creator("测试创作者")
    content_id, _ = kstore.upsert_content(
        cid, platform="youtube", url="https://y/m1", content_type="video", title="方法期",
        published_at=datetime(2026, 7, 8, tzinfo=timezone.utc), raw="隧道可以回测")
    kstore.record_extraction(content_id, extractor_version="vm", model="m", units=[
        KnowledgeUnit(kind="method", quote="隧道可以回测", payload={
            "name": "可回测隧道", "summary": "s", "family": "trend",
            "rules": ["r"], "data_requirements": ["日线"], "testability": "A"}),
        KnowledgeUnit(kind="method", quote="隧道可以回测", locator="00:01", payload={
            "name": "不可回测", "summary": "s", "family": "other",
            "rules": ["r"], "testability": "C"})])
    ns.seed_singletons(merger_version="merge-v1")
    cands = discovery.harness_candidates(pool)
    assert [c["title"] for c in cands] == ["可回测隧道"]

    # 周报：落盘到 tmp 并包含关键小节
    monkeypatch.setattr(discovery, "REPORT_DIR", tmp_path)
    rep = discovery.weekly_report(pool, days=30)
    assert "知识引擎周报" in rep["markdown"] and "节点状态" in rep["markdown"]
    assert rep["summary"]["spot_check"]["total"] >= 3
    assert isinstance(rep["summary"]["due_next"], list)
    assert (tmp_path / pathlib.Path(rep["path"]).name).exists()

    # 抽查：sample 不重复已查、record 后计入 stats
    got = spotcheck.sample(pool, 3)
    assert len(got) == 3
    spotcheck.record(pool, got[0]["id"], "faithful", "ok")
    s = spotcheck.stats(pool)
    assert s["checked"] == 1 and s["faithful"] == 1
    assert got[0]["id"] not in [r["id"] for r in spotcheck.sample(pool, 50)]
    with pytest.raises(SystemExit):
        spotcheck.record(pool, got[0]["id"], "bogus", None)


# --- K2：Gemini 转录接入 / 关键帧 ---------------------------------------------

def test_gemini_request_assembly(monkeypatch):
    # 请求组装：file_data 传 URL、clip offset 进 video_metadata、response_schema 带上
    from analyzer.knowledge import llm
    captured = {}

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"candidates": [{"content": {"parts": [{"text":
                '{"lang":"zh","transcript":"原油看多","visual_notes":'
                '[{"t":"03:15","kind":"chart","note":"WTI 日线标注 75 阻力"}]}'}]}}]}

    def fake_post(url, params=None, json=None, timeout=None):
        captured.update({"url": url, "json": json})
        return FakeResp()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    out = llm.GeminiClient("k").transcribe_youtube(
        "https://www.youtube.com/watch?v=abc", start_s=190, end_s=210)
    parts = captured["json"]["contents"][0]["parts"]
    assert parts[0]["file_data"]["file_uri"].endswith("v=abc")
    assert parts[0]["video_metadata"] == {"start_offset": "190s", "end_offset": "210s"}
    assert captured["json"]["generationConfig"]["response_schema"] is llm.TRANSCRIBE_SCHEMA
    assert out["visual_notes"][0]["t"] == "03:15"

    text = llm.render_l0_text(out)
    assert "原油看多" in text and "- [03:15] (chart) WTI 日线标注 75 阻力" in text


def test_keyframes_ts_parse():
    from analyzer.knowledge.keyframes import _to_seconds
    assert _to_seconds("03:15") == 195
    assert _to_seconds("1:02:05") == 3725
    assert _to_seconds("90") == 90 and _to_seconds(90) == 90


def test_keyframes_cli_height_not_taken_as_timestamp(monkeypatch):
    """--height 的值曾被当成时间戳解析（IndexError），且 --height 对清晰度不起作用。"""
    from analyzer.knowledge import keyframes

    seen = {}
    monkeypatch.setattr(keyframes, "grab", lambda vid, ts, **kw: seen.update(
        video_id=vid, ts=list(ts), **kw) or [])
    monkeypatch.setattr(sys, "argv",
                        ["keyframes", "vid123", "03:15", "10:00", "--height", "720"])
    keyframes.main()
    assert seen["video_id"] == "vid123" and seen["ts"] == ["03:15", "10:00"]
    assert seen["max_height"] == 720


def test_keyframes_format_selector_prefers_dash_video_track(monkeypatch):
    """混流 mp4 只有 640×360 的 fmt 18：选串必须先要 DASH 视频轨，否则清晰度封顶 360p。"""
    from analyzer.knowledge import keyframes

    captured = {}

    class _FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            return {"url": "https://cdn/seg", "height": 1080, "duration": 1800}

    monkeypatch.setattr(keyframes.yt_dlp, "YoutubeDL", _FakeYDL)
    st = keyframes.stream_url("vid123", max_height=1080)
    assert captured["format"].startswith("bv*[vcodec^=avc1][height<=1080]")
    assert st.source == "ytdlp:android_vr" and st.height == 1080 and st.duration_s == 1800


def test_visual_notes_parse_from_l0():
    from analyzer.knowledge.backfill_keyframes import visual_notes

    raw = ("正文若干\n\n## 视觉笔记（画面信息，带时间戳）\n"
           "- [00:08] (table) 盘面表现表格\n"
           "- [03:15] (chart) WTI 日线标注 75 阻力\n"
           "- [03:15] (chart) 同一画面的第二条笔记\n"
           "- [1:02:05] (text_slide) 免责声明\n"
           "- 不带时间戳的行应忽略\n")
    notes = visual_notes(raw)
    assert [n["ts_s"] for n in notes] == [8, 195, 3725]          # 同秒合并、按时间排序
    assert notes[1]["note"].endswith("第二条笔记") and "75 阻力" in notes[1]["note"]
    assert notes[2]["kind"] == "text_slide"


def test_keyframe_store_roundtrip(kstore):
    creator = kstore.ensure_creator("测试创作者")
    cid, _ = kstore.upsert_content(
        creator, platform="youtube", url="https://y/t9", content_type="video",
        title="提帧测试", published_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        raw="正文\n- [03:15] (chart) WTI")
    kstore.record_keyframe(cid, ts_s=195, path="keyframes/vid/00195s_h720.jpg", height=720,
                           bytes_=100_000, source="ytdlp:android_vr", kind="chart", note="WTI")
    assert kstore.keyframe_seconds(cid) == {195}
    # 重抓更高清晰度：同 (content, ts) 覆盖，不留重复行；kind/note 不被 NULL 冲掉
    kstore.record_keyframe(cid, ts_s=195, path="keyframes/vid/00195s_h1080.jpg", height=1080,
                           bytes_=230_000, source="ytdlp:tv")
    rows = kstore.keyframes_for_content(cid)
    assert len(rows) == 1 and rows[0]["height"] == 1080 and rows[0]["source"] == "ytdlp:tv"
    assert rows[0]["note"] == "WTI" and rows[0]["bytes"] == 230_000


def test_keyframe_fill_gaps_only_touches_frameless_contents(kstore, monkeypatch):
    from analyzer.knowledge import backfill_keyframes as bk

    creator = kstore.ensure_creator("测试创作者")
    ids = []
    for i in (1, 2):
        cid, _ = kstore.upsert_content(
            creator, platform="youtube", url=f"https://www.youtube.com/watch?v=vid0000000{i}",
            content_type="video", title=f"第{i}期",
            published_at=datetime(2026, 8, i, tzinfo=timezone.utc),
            raw=f"正文{i}\n- [00:10] (chart) 画面")
        ids.append(cid)
    kstore.record_keyframe(ids[0], ts_s=10, path="keyframes/a/00010s_h1080.jpg", height=1080,
                           bytes_=1, source="ytdlp:tv")

    touched = []
    monkeypatch.setattr(bk, "grab_for_content",
                        lambda store, c, **kw: touched.append(c["id"]) or 3)
    assert bk.fill_gaps(kstore, limit=10) == 3      # 只跑没帧的那条
    assert touched == [ids[1]]
