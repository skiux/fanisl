"""知识引擎 K0：schema 往返 / 载荷校验 / 幂等与版本化重放。"""

import pathlib
import sys

import pytest
from datetime import datetime, timezone

from fanisl.knowledge.models import ClaimPayload, KnowledgeUnit
from fanisl.knowledge.nodes import NodeStore
from fanisl.knowledge.store import KnowledgeStore


@pytest.fixture
def kstore(pool):
    # verification_detail joins the node provenance tables; initialize that
    # schema explicitly so this fixture is independent of test collection order.
    NodeStore(pool)
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
    assert ids2 != ids
    # 升版重提：旧单元一条不删，但**只有当前生效那版进下游视图**——否则联赛表/含糊率/
    # 抽查覆盖率会把同一期内容数两遍
    assert len(kstore.units(kind="claim")) == 1
    assert kstore.units(kind="claim")[0]["extractor_version"] == "v2"
    runs = kstore.runs_for_content(content_id)
    assert [(r["extractor_version"], r["status"]) for r in runs] == [
        ("v1", "superseded"), ("v2", "active")]
    # 列表视图：带信源名/字数/单元数，不含 raw 全文
    rows = kstore.list_contents()
    assert rows[0]["creator"] == "测试创作者" and rows[0]["n_units"] == 1
    assert rows[0]["raw_len"] > 0 and "raw" not in rows[0]


def test_activate_run_switches_back_without_losing_either_version(kstore):
    """回退路径：v2 重提后发现不如 v1，切回去即可，两版单元都还在库里。"""
    cid = kstore.ensure_creator("回退信源")
    content_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/rollback", content_type="article",
        title="回退样本", published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw="原油判断")
    unit = KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=_claim())
    kstore.record_extraction(content_id, extractor_version="v1", model="m", units=[unit])
    kstore.record_extraction(content_id, extractor_version="v2", model="m", units=[unit, unit])

    assert len(kstore.units_for_content(content_id)) == 2      # 当前是 v2
    v1_run = next(r for r in kstore.runs_for_content(content_id)
                  if r["extractor_version"] == "v1")
    kstore.activate_run(v1_run["id"])

    active = kstore.units_for_content(content_id)
    assert len(active) == 1 and active[0]["extractor_version"] == "v1"
    # v2 的单元没被删，只是不再生效
    assert [(r["extractor_version"], r["status"]) for r in kstore.runs_for_content(content_id)] == [
        ("v1", "active"), ("v2", "superseded")]


def test_only_one_run_can_be_active_per_content(kstore):
    """数据库层兜底：部分唯一索引不允许同一条 content 出现两个 active run。"""
    import psycopg

    cid = kstore.ensure_creator("并发信源")
    content_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/one-active", content_type="article",
        title="唯一 active", published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw="判断")
    unit = KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=_claim())
    kstore.record_extraction(content_id, extractor_version="v1", model="m", units=[unit])
    kstore.record_extraction(content_id, extractor_version="v2", model="m", units=[unit])

    with pytest.raises(psycopg.errors.UniqueViolation):
        with kstore.pool.connection() as conn:
            conn.execute("UPDATE extraction_runs SET status='active' WHERE content_id=%s",
                         (content_id,))


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
    from fanisl.knowledge.import_units import check_quotes, parse_units_doc
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
    from fanisl.knowledge import scorers
    from fanisl.knowledge.prices import PriceStore
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


def test_scorer_run_isolates_a_bad_unit(pool, monkeypatch):
    """一条解析不了的单元只让自己失败：id 比它大的照常评分，失败在全部评完后抛出。

    2026-08-29 至 09-23，几条 range_hold 的配置与 success_def 对不上（#1230、#799 等），每天在
    run() 里抛错，id 更大的单元一条新评分都没有，而外层 daily 只记一行日志。"""
    import datetime as dt
    from fanisl.knowledge import scorers
    from fanisl.knowledge.prices import PriceStore
    from fanisl.knowledge.store import KnowledgeStore
    # 测试库的单元 id 从 1 起，会撞上真实 scoring_overrides.json 里的 #1、#2
    monkeypatch.setattr(scorers, "OVERRIDES", {})
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
                     "claim_scores RESTART IDENTITY CASCADE")
        conn.execute("DELETE FROM daily_bars WHERE symbol='WTI'")
    PriceStore(pool).upsert("WTI", [(dt.date(2026, 7, 1), 70, 70, 70, 70),
                                    (dt.date(2026, 7, 8), 71, 72, 70, 71)], "test")
    ks = KnowledgeStore(pool)
    cid, _ = ks.upsert_content(ks.ensure_creator("t"), platform="youtube", url="https://y/iso",
                               content_type="video", title="t",
                               published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw="原油会去测 75")
    spec = {"eval_ladder": ["2026-07-08"], "success_def": "t"}
    bad = _claim(asset_symbol="WTI", direction="range", magnitude=None,
                 scoring_spec={"method": "range_hold", **spec})
    good = _claim(asset_symbol="WTI", magnitude=None, scoring_spec={"method": "sign", **spec})
    bad_id, good_id = ks.record_extraction(cid, extractor_version="v2", model="m", units=[
        KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=bad),
        KnowledgeUnit(kind="claim", quote="原油会去测 75", payload=good)])
    assert bad_id < good_id

    with pytest.raises(RuntimeError, match=f"#{bad_id}@2026-07-08"):
        scorers.run(dry=False)
    with pool.connection() as conn:
        scored = conn.execute("SELECT unit_id, outcome FROM claim_scores").fetchall()
    assert [(r["unit_id"], r["outcome"]) for r in scored] == [(good_id, "hit")]


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



def test_scorer_condition_after_and_explicit_op(monkeypatch):
    """条件的 after 起点、sign 的显式比较符：两者都为阶梯序列（政策利率）上的事件型 claim 而设。"""
    import datetime as dt
    from fanisl.knowledge import scorers

    rate = {dt.date(2026, 9, d): 3.75 for d in (14, 15, 16)}
    rate.update({dt.date(2026, 9, d): 4.00 for d in (17, 18)})
    rate.update({dt.date(2026, 11, 30): 4.00, dt.date(2026, 12, 31): 4.00})

    class PS:
        def close_on_or_before(self, sym, d):
            ks = [k for k in rate if k <= d]
            return (max(ks), rate[max(ks)]) if ks else None

    def bars(ps, sym, start, until):
        return [{"ts": k, "close": v, "high": v, "low": v} for k, v in sorted(rate.items()) if start <= k <= until]

    monkeypatch.setattr(scorers, "_bars", bars)
    pub, until = dt.date(2026, 9, 13), dt.date(2026, 9, 20)
    no_hike = {"type": "close_below", "symbol": "DFEDTARU", "level": 3.76}
    # 不设 after：会前利率本来就是 3.75，条件在发布次日被误判成立
    assert scorers._resolve_condition(PS(), no_hike, "SPX", pub, until) == (dt.date(2026, 9, 14), None)
    # 设 after：只看议息之后，加息了 → 条件不成立
    assert scorers._resolve_condition(PS(), {**no_hike, "after": "2026-09-17"}, "SPX", pub, until) == \
        (None, "condition_not_met")

    # 显式严格号：12-31 与 11-30 相同（12 月没加息）→ miss；up 的默认 >= 会判 hit
    assert scorers._score_sign("up", 4.00, 4.00, {}) == "hit"
    assert scorers._score_sign("up", 4.00, 4.00, {"op": ">"}) == "miss"
    assert scorers._score_sign("up", 4.25, 4.00, {"op": ">"}) == "hit"
    assert scorers._score_sign(None, 4.00, 4.00, {"op": "<="}) == "hit"
    # 既有的 ">=" + ref_factor 行为不变（overrides 93、173 在用）
    assert scorers._score_sign("up", 96.0, 100.0, {"op": ">=", "ref_factor": 0.95}) == "hit"

def test_nodes_import_gates_and_lifecycle(kstore, pool):
    from fanisl.knowledge.nodes import NodeStore
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
    from fanisl.knowledge import discovery, spotcheck
    from fanisl.knowledge.nodes import NodeStore
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
    from fanisl.knowledge import llm
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
    from fanisl.knowledge.keyframes import _to_seconds
    assert _to_seconds("03:15") == 195
    assert _to_seconds("1:02:05") == 3725
    assert _to_seconds("90") == 90 and _to_seconds(90) == 90


def test_keyframes_cli_height_not_taken_as_timestamp(monkeypatch):
    """--height 的值曾被当成时间戳解析（IndexError），且 --height 对清晰度不起作用。"""
    from fanisl.knowledge import keyframes

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
    from fanisl.knowledge import keyframes

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
    from fanisl.knowledge.backfill_keyframes import visual_notes

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
    from fanisl.knowledge import backfill_keyframes as bk

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


def test_correct_canonical_keeps_an_audit_trail(kstore):
    """canonical 订正必须留痕：不留痕的静默改写，和它要修的那类问题是一回事。"""
    from fanisl.knowledge.nodes import NodeStore

    ns = NodeStore(kstore.pool)
    cid = kstore.ensure_creator("订正信源")
    content_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/correct", content_type="article",
        title="订正样本", published_at=datetime(2026, 7, 1, tzinfo=timezone.utc), raw="原文")
    uid = kstore.record_extraction(content_id, extractor_version="v1", model="m", units=[
        KnowledgeUnit(kind="concept", quote="原文", payload={
            "canonical_statement": "甲骨文 27 财年营收 901 亿", "category": "market_structure"}),
    ])[0]
    node_id = ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
        "kind": "concept", "title": "甲骨文体量", "canonical": "甲骨文 27 财年营收 901 亿",
        "units": [{"id": uid}]}]})[0]

    out = ns.correct_canonical(node_id, "甲骨文 27 财年营收 900 亿", "原文说的是 90 个 billion")
    assert out["old"].endswith("901 亿") and out["new"].endswith("900 亿")

    node = ns.get_node(node_id)
    assert node["canonical"] == "甲骨文 27 财年营收 900 亿"
    assert "[订正 canonical]" in node["notes"]
    assert "901 亿" in node["notes"]          # 原值可追
    assert "90 个 billion" in node["notes"]   # 理由可追


def test_correct_canonical_rejects_unknown_node(kstore):
    from fanisl.knowledge.nodes import NodeStore

    with pytest.raises(ValueError):
        NodeStore(kstore.pool).correct_canonical(999999, "x", "y")


def test_fetch_yf_drops_todays_incomplete_bar(monkeypatch):
    """盘中拉到的"当日 K"是还在动的快照，写进库会让评分器拿盘中价当收盘价永久定死。"""
    import datetime as dt

    import pandas as pd

    import fanisl.knowledge.prices as pricemod

    today = dt.date.today()
    idx = pd.to_datetime([today - dt.timedelta(days=2), today - dt.timedelta(days=1), today])
    df = pd.DataFrame({"Open": [1.0, 2.0, 3.0], "High": [1.0, 2.0, 3.0],
                       "Low": [1.0, 2.0, 3.0], "Close": [1.0, 2.0, 3.0]}, index=idx)

    class _T:
        def __init__(self, *_a, **_k): pass
        def history(self, **_k): return df

    fake_yf = type("m", (), {"Ticker": _T})
    monkeypatch.setitem(__import__("sys").modules, "yfinance", fake_yf)
    monkeypatch.setitem(pricemod.SYMBOL_MAP, "ZZTEST", ("ZZTEST", 1.0, ""))

    rows = pricemod.fetch_yf("ZZTEST", today - dt.timedelta(days=10))
    got = [r[0] for r in rows]
    assert today not in got, "今天那根未收盘的 K 不能进库"
    assert got == [today - dt.timedelta(days=2), today - dt.timedelta(days=1)]


def test_fetch_yf_uses_exchange_tz_not_local_date(monkeypatch):
    """闸门必须按标的自己交易所的时区判"今天"，不能用本机日期。

    2026-08-17 事故：本机 CST(UTC+8)，美股 12:00-16:00 ET 落在本地次日凌晨，
    `date.today()` 已翻篇而 ET 还没收盘 → 82 个符号的盘中价被当收盘价入库，
    10 条判定按盘中价定死。yfinance 的索引自带交易所时区，直接拿它比。
    """
    import datetime as dt

    import pandas as pd

    import fanisl.knowledge.prices as pricemod

    class _T:
        def __init__(self, *_a, **_k): pass
        def history(self, **_k): return _T.df

    fake_yf = type("m", (), {"Ticker": _T})
    monkeypatch.setitem(__import__("sys").modules, "yfinance", fake_yf)
    monkeypatch.setitem(pricemod.SYMBOL_MAP, "ZZTEST", ("ZZTEST", 1.0, ""))

    # 冻结成事故当刻：ET 2026-08-17 13:31（美股盘中），本机 CST 已是 08-18。
    # 不用真实时钟，否则能不能测到这个 bug 取决于跑测试的机器在哪个时区、几点跑。
    instant = dt.datetime(2026, 8, 17, 13, 31, tzinfo=dt.timezone(dt.timedelta(hours=-4)))

    class _FakeDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    class _FakeDate(dt.date):
        @classmethod
        def today(cls):
            return dt.date(2026, 8, 18)      # 本机 CST 日期：已经翻篇

    monkeypatch.setattr(pricemod, "dt", type("m", (), {
        "datetime": _FakeDatetime, "date": _FakeDate,
        "timedelta": dt.timedelta, "timezone": dt.timezone}))

    def _run(offset_h, days):
        tz = dt.timezone(dt.timedelta(hours=offset_h))
        _T.df = pd.DataFrame(
            {"Open": [1.0] * len(days), "High": [1.0] * len(days),
             "Low": [1.0] * len(days), "Close": [1.0] * len(days)},
            index=pd.to_datetime(days).tz_localize(tz))
        return [r[0] for r in pricemod.fetch_yf("ZZTEST", days[0] - dt.timedelta(days=5))]

    # 美股(ET)：08-17 那根还在走，必须丢掉——本机日期已是 08-18，旧闸门正是在这里失效的
    us = [dt.date(2026, 8, 14), dt.date(2026, 8, 17)]
    assert _run(-4, us) == us[:1], "美股盘中那根必须按 ET 判并丢掉"

    # 亚洲(KST)：同一时刻当地已是 08-18 凌晨，08-17 早已收盘，应当保留
    kr = [dt.date(2026, 8, 14), dt.date(2026, 8, 17)]
    assert _run(9, kr) == kr, "亚洲标的已收盘的那根不该陪美股一起被丢"


# --- seed-singletons 的顺序闸（2026-08-16 撞过一次）---------------------------

def _concept_unit(text, tags):
    return KnowledgeUnit(kind="concept", quote=text, tags=tags,
                         payload={"canonical_statement": text, "category": "market_structure"})


def test_seed_singletons_dry_run_writes_nothing(kstore):
    from fanisl.knowledge.nodes import NodeStore

    ns = NodeStore(kstore.pool)
    cid = kstore.ensure_creator("闸门信源")
    content_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/seed", content_type="article",
        title="种子", published_at=datetime(2026, 8, 16, tzinfo=timezone.utc), raw="一条认知")
    kstore.record_extraction(content_id, extractor_version="v1", model="m",
                             units=[_concept_unit("一条认知", ["ai-capex"])])

    assert ns.seed_singletons(merger_version="merge-v1", dry_run=True) == 1
    assert ns.list_nodes() == [], "dry_run 不许写库"
    assert ns.seed_singletons(merger_version="merge-v1") == 1
    assert len(ns.list_nodes()) == 1


def test_pending_singletons_surfaces_tag_nearest_existing_node(kstore):
    """真实场景：同一信源隔期重述同一命题，用词几乎全变，靠标签才捞得回来。"""
    from fanisl.knowledge.nodes import NodeStore

    ns = NodeStore(kstore.pool)
    cid = kstore.ensure_creator("重述信源")
    old_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/jun", content_type="article",
        title="六月", published_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        raw="组织架构围绕人类脑力搭建")
    uid = kstore.record_extraction(old_id, extractor_version="v1", model="m", units=[
        _concept_unit("组织架构围绕人类脑力搭建", ["ai-capex", "macro-framework"])])[0]
    node_id = ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
        "kind": "concept", "title": "生产力未质变的根因",
        "canonical": "组织架构围绕人类脑力搭建", "tags": ["ai-capex", "macro-framework"],
        "units": [{"id": uid}]}]})[0]

    new_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/aug", content_type="article",
        title="八月", published_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
        raw="技术革新只是前提，组织架构创新才是关键")
    kstore.record_extraction(new_id, extractor_version="v1", model="m", units=[
        _concept_unit("技术革新只是前提，组织架构创新才是关键",
                      ["ai-capex", "macro-framework"])])

    pending = ns.pending_singletons()
    assert len(pending) == 1
    cands = pending[0]["candidates"]
    assert cands and cands[0][0]["id"] == node_id, "该并入的既有节点必须出现在短名单里"
    assert cands[0][1] == 1.0                       # 标签完全一致


def test_pending_singletons_ignores_units_already_on_a_node(kstore):
    from fanisl.knowledge.nodes import NodeStore

    ns = NodeStore(kstore.pool)
    cid = kstore.ensure_creator("已挂信源")
    content_id, _ = kstore.upsert_content(
        cid, platform="manual", url="https://example.test/done", content_type="article",
        title="已挂", published_at=datetime(2026, 8, 16, tzinfo=timezone.utc), raw="已挂认知")
    uid = kstore.record_extraction(content_id, extractor_version="v1", model="m",
                                   units=[_concept_unit("已挂认知", ["valuation"])])[0]
    ns.import_nodes({"merger_version": "merge-v1", "nodes": [{
        "kind": "concept", "title": "已挂", "canonical": "已挂认知",
        "tags": ["valuation"], "units": [{"id": uid}]}]})
    assert ns.pending_singletons() == []


# --- Vertex 通道的两条鉴权路径（2026-08-19 补：服务器上不该放个人 refresh token）---

def _vertex_client(monkeypatch, tmp_path, adc: dict | None):
    """构造 VertexGeminiClient，并把 ADC 路径指到临时目录（存在与否由 adc 决定）。"""
    import json as _json

    import fanisl.knowledge.llm as llmmod

    p = tmp_path / "application_default_credentials.json"
    if adc is not None:
        p.write_text(_json.dumps(adc))
    monkeypatch.setattr(llmmod, "_ADC_PATH", p)
    return llmmod, llmmod.VertexGeminiClient("proj-x")


def test_vertex_token_from_adc_file(monkeypatch, tmp_path):
    """开发机：有 authorized_user 文件就用它换 token，不碰元数据服务器。"""
    llmmod, c = _vertex_client(monkeypatch, tmp_path, {
        "type": "authorized_user", "client_id": "cid",
        "client_secret": "sec", "refresh_token": "rt"})

    calls = []

    class _R:
        def raise_for_status(self): pass
        def json(self): return {"access_token": "tok-file", "expires_in": 3600}

    monkeypatch.setattr(llmmod.httpx, "post", lambda *a, **k: (calls.append(a), _R())[1])
    monkeypatch.setattr(llmmod.httpx, "get", lambda *a, **k: pytest.fail("不该查元数据服务器"))
    assert c._access_token() == "tok-file"
    assert calls, "应当走 oauth2 refresh_token 换取"


def test_vertex_token_from_metadata_when_no_adc(monkeypatch, tmp_path):
    """GCE：没有 ADC 文件就走元数据服务器——服务器上零凭据落盘。"""
    llmmod, c = _vertex_client(monkeypatch, tmp_path, None)

    seen = {}

    class _R:
        def raise_for_status(self): pass
        def json(self): return {"access_token": "tok-metadata", "expires_in": 3600}

    def _get(url, **kw):
        seen["url"], seen["headers"] = url, kw.get("headers")
        return _R()

    monkeypatch.setattr(llmmod.httpx, "get", _get)
    assert c._access_token() == "tok-metadata"
    assert "metadata.google.internal" in seen["url"]
    assert seen["headers"] == {"Metadata-Flavor": "Google"}, "元数据服务器要求该请求头"


def test_vertex_rejects_service_account_file(monkeypatch, tmp_path):
    """service_account 文件要给出可操作的报错，而不是 KeyError('refresh_token')。"""
    llmmod, c = _vertex_client(monkeypatch, tmp_path, {
        "type": "service_account", "private_key": "x", "client_email": "a@b"})
    with pytest.raises(RuntimeError, match="authorized_user"):
        c._access_token()


def test_daily_ingests_every_channel_before_scoring(monkeypatch):
    """日维护要先摄取再评分：当天新入库的内容当天就能进后续环节。

    2026-08-19 之前 daily 完全不碰摄取，三个频道的新内容全靠手动跑
    backfill_transcripts——漏跑就是永久缺口（视频删了 L0 就没了）。
    """
    import fanisl.knowledge.daily as dailymod

    order, ingested = [], []
    monkeypatch.setattr(dailymod.backfill_transcripts, "run",
                        lambda h, **kw: (ingested.append((h, kw)), order.append("ingest")))
    monkeypatch.setattr(dailymod.prices, "refresh", lambda *a, **k: order.append("prices"))
    monkeypatch.setattr(dailymod.estimates, "refresh", lambda *a, **k: (order.append("estimates"), {"stored": 0, "tried": 0})[1])
    monkeypatch.setattr(dailymod.scorers, "run", lambda **k: order.append("scorers"))
    monkeypatch.setattr(dailymod, "price_since", lambda pool: __import__("datetime").date(2026, 5, 1))
    monkeypatch.setattr(dailymod, "ingest_since_days", lambda pool, h, **k: 4)
    monkeypatch.setattr(dailymod, "NodeStore", lambda pool: type("N", (), {"recompute": lambda s: {}})())
    monkeypatch.setattr(dailymod, "KnowledgeStore", lambda pool: object())
    monkeypatch.setattr(dailymod.backfill_keyframes, "fill_gaps", lambda *a, **k: 0)

    dailymod.run_daily(object())

    assert [h for h, _ in ingested] == ["@andyleegogo", "@MeiTouJun", "@MeiTouNews", "@yttalkjun"], \
        "每个频道都要扫，漏一个就是那个频道永久断更"
    assert all(kw["since_days"] >= 2 for _, kw in ingested), "窗口按缺口算，且不低于下限 2 天"
    assert all(kw["max_new"] == 5 for _, kw in ingested), "护栏：异常放量时停下来让人看"
    assert order.index("ingest") < order.index("scorers"), "摄取必须排在评分之前"


def test_daily_continues_when_one_source_fails(monkeypatch):
    """单个信源摄取失败不能拖垮整轮日维护。"""
    import fanisl.knowledge.daily as dailymod

    seen = []

    def _run(handle, **kw):
        seen.append(handle)
        if handle == "@MeiTouJun":
            raise RuntimeError("配额用尽")

    monkeypatch.setattr(dailymod.backfill_transcripts, "run", _run)
    monkeypatch.setattr(dailymod.prices, "refresh", lambda *a, **k: seen.append("prices"))
    monkeypatch.setattr(dailymod.estimates, "refresh", lambda *a, **k: {"stored": 0, "tried": 0})
    monkeypatch.setattr(dailymod.scorers, "run", lambda **k: seen.append("scorers"))
    monkeypatch.setattr(dailymod, "price_since", lambda pool: __import__("datetime").date(2026, 5, 1))
    monkeypatch.setattr(dailymod, "ingest_since_days", lambda pool, h, **k: 4)
    monkeypatch.setattr(dailymod, "NodeStore", lambda pool: type("N", (), {"recompute": lambda s: {}})())
    monkeypatch.setattr(dailymod, "KnowledgeStore", lambda pool: object())
    monkeypatch.setattr(dailymod.backfill_keyframes, "fill_gaps", lambda *a, **k: 0)

    dailymod.run_daily(object())

    assert "@yttalkjun" in seen, "一个信源失败后，后面的信源仍要继续"
    assert "scorers" in seen, "摄取失败不影响评分等后续环节"


def test_ingest_window_covers_the_whole_gap(kstore):
    """窗口按缺口算：停机多久就回看多久，不会静默漏掉中间的内容。

    固定窗口（"近 N 天"）的失效模式是无声的——collector 停机超过 N 天，中间那几期
    在频道清单里仍在、库里却永远不会有，事后也没有任何迹象。
    """
    import datetime as _dt

    import fanisl.knowledge.daily as dailymod

    cid = kstore.ensure_creator("窗口信源")
    kstore.ensure_handle(cid, "youtube", "@gaptest")
    kstore.upsert_content(cid, platform="youtube", url="https://y/gap1", content_type="video",
                          title="最新一期", published_at=_dt.datetime(2026, 8, 1, tzinfo=_dt.timezone.utc),
                          raw="判断", handle="@gaptest")
    now = _dt.datetime(2026, 8, 20, tzinfo=_dt.timezone.utc)

    days = dailymod.ingest_since_days(kstore.pool, "@gaptest", now=now)
    assert days >= 19, f"8/1 到 8/20 的缺口是 19 天，窗口必须覆盖全部，实得 {days}"

    # 刚更新过也不会缩到 0——下限保证时区差不会造成漏抓
    kstore.upsert_content(cid, platform="youtube", url="https://y/gap2", content_type="video",
                          title="今天这期", published_at=now, raw="今天的判断", handle="@gaptest")
    assert dailymod.ingest_since_days(kstore.pool, "@gaptest", now=now) == dailymod.INGEST_MIN_DAYS

    # 库里没有该信源的内容时给一个有限的起步窗口，而不是 0 或无穷
    assert dailymod.ingest_since_days(kstore.pool, "@never-seen", now=now) == 30


def test_unregistered_channel_is_an_ordinary_error_for_daily(kstore, monkeypatch):
    """频道未登记时 run() 抛普通异常，日维护能接住、继续下一个频道。

    原先是 SystemExit：它不是 Exception 的子类，会穿过 daily 与调度器的 except，
    在线程里静默结束整条调度线程。
    """
    import fanisl.knowledge.backfill_transcripts as bt

    class _Pool:   # run() 结束时会 close 自己的池；这里借测试池，不能真关
        def __init__(self, pool):
            self._pool = pool

        def connection(self):
            return self._pool.connection()

        def close(self):
            pass

    monkeypatch.setattr(bt, "make_pool", lambda *a, **k: _Pool(kstore.pool))
    monkeypatch.setattr(bt, "make_client", lambda *a, **k: object())
    with pytest.raises(LookupError, match="未登记"):
        bt.run("@not-registered", since_days=2)


def test_capped_ingest_takes_the_oldest_first_so_the_next_window_still_covers_the_rest(kstore, monkeypatch):
    """上限截断时从最旧的开始转录，剩下的仍在下一轮窗口里。

    原先新→旧转录：最新几期一入库，按"最新一期距今"算的窗口就缩回 2 天，更早的几期
    永远进不了窗口。2026-09-24 @MeiTouNews 首轮回看 30 天只入库了最新 5 期，其余约 20 期被留下。
    """
    import datetime as _dt

    import fanisl.knowledge.backfill_transcripts as bt
    import fanisl.knowledge.daily as dailymod

    now = _dt.datetime.now(_dt.timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    days_ago = {f"v{k}": k for k in range(8)}            # v0 今天 … v7 七天前；清单新→旧

    class _Pool:
        def __init__(self, pool):
            self._pool = pool

        def connection(self):
            return self._pool.connection()

        def close(self):
            pass

    class _Client:
        model, last_usage = "fake", {}

    cid = kstore.ensure_creator("日更信源")
    kstore.ensure_handle(cid, "youtube", "@catchup")
    monkeypatch.setattr(bt, "make_pool", lambda *a, **k: _Pool(kstore.pool))
    monkeypatch.setattr(bt, "make_client", lambda *a, **k: _Client())
    monkeypatch.setattr(bt, "list_videos", lambda h, **k: [
        {"video_id": v, "title": v, "url": ""} for v in sorted(days_ago, key=days_ago.get)])
    monkeypatch.setattr(bt, "fetch_transcript", lambda v: {
        "published_at": now - _dt.timedelta(days=days_ago[v]), "title": v})
    monkeypatch.setattr(bt, "_transcribe_with_retry",
                        lambda c, url: {"transcript": f"转录 {url}", "visual_notes": []})
    monkeypatch.setattr(bt, "render_l0_text", lambda tr: tr["transcript"])
    monkeypatch.setattr(bt, "grab_for_content", lambda *a, **k: 0)
    monkeypatch.setattr(bt, "SLEEP_BETWEEN_S", 0)

    bt.run("@catchup", since_days=10, max_new=3)
    with kstore.pool.connection() as conn:
        got = [r["title"] for r in conn.execute(
            "SELECT title FROM contents WHERE handle='@catchup' ORDER BY published_at").fetchall()]
    assert got == ["v7", "v6", "v5"], f"截断时要先入库最旧的，实得 {got}"

    days = dailymod.ingest_since_days(kstore.pool, "@catchup", now=now)
    assert days >= 5, f"剩下的 v0–v4 必须仍在下一轮窗口里，实得 {days} 天"


def test_reference_channel_contents_are_not_queued_for_extraction(kstore, monkeypatch):
    """只供阅读的频道（store.REFERENCE_HANDLES）入库即为 reference，不进待提取；别的频道照旧 new。"""
    import fanisl.knowledge.store as storemod

    monkeypatch.setattr(storemod, "REFERENCE_HANDLES", frozenset({"@news"}))
    cid = kstore.ensure_creator("新闻信源")
    a, _ = kstore.upsert_content(cid, platform="youtube", url="https://y/n1", content_type="video",
                                 title="新闻", published_at=None, raw="新闻原文", handle="@news")
    b, _ = kstore.upsert_content(cid, platform="youtube", url="https://y/j1", content_type="video",
                                 title="观点", published_at=None, raw="观点原文", handle="@views")
    assert kstore.get_content(a)["status"] == "reference"
    assert kstore.get_content(b)["status"] == "new"
    assert {r["id"] for r in kstore.list_contents()} >= {a, b}, "reference 仍在内容列表里供阅读"


def test_ingest_window_is_per_channel_not_per_creator(kstore):
    """一个信源两个频道时，缺口按频道算（美投君：@MeiTouJun 周更、@MeiTouNews 日更）。

    按信源算的话，一个频道今天刚更新，另一个频道停了十天的缺口就被遮住，只回看下限 2 天。
    """
    import datetime as _dt

    import fanisl.knowledge.daily as dailymod

    now = _dt.datetime(2026, 8, 20, tzinfo=_dt.timezone.utc)
    cid = kstore.ensure_creator("双频道信源")
    kstore.ensure_handle(cid, "youtube", "@weekly")
    kstore.ensure_handle(cid, "youtube", "@daily")
    kstore.upsert_content(cid, platform="youtube", url="https://y/w1", content_type="video",
                          title="周更", published_at=now, raw="周更判断", handle="@weekly")
    kstore.upsert_content(cid, platform="youtube", url="https://y/d1", content_type="video",
                          title="日更", published_at=_dt.datetime(2026, 8, 10, tzinfo=_dt.timezone.utc),
                          raw="日更判断", handle="@daily")

    assert dailymod.ingest_since_days(kstore.pool, "@weekly", now=now) == dailymod.INGEST_MIN_DAYS
    assert dailymod.ingest_since_days(kstore.pool, "@daily", now=now) >= 10, \
        "@weekly 今天更新过，不能遮住 @daily 停了十天的缺口"


def test_old_contents_get_their_channel_only_when_it_is_unambiguous(kstore):
    """迁移：只登记了一个频道的信源，老内容回填那个频道；多频道的信源推不出来，保持为空。"""
    from fanisl.knowledge.store import KnowledgeStore

    one = kstore.ensure_creator("单频道")
    kstore.ensure_handle(one, "youtube", "@only")
    two = kstore.ensure_creator("多频道")
    kstore.ensure_handle(two, "youtube", "@a")
    kstore.ensure_handle(two, "youtube", "@b")
    a, _ = kstore.upsert_content(one, platform="youtube", url="https://y/o1", content_type="video",
                                 title="t", published_at=None, raw="单频道老内容")
    b, _ = kstore.upsert_content(two, platform="youtube", url="https://y/m1", content_type="video",
                                 title="t", published_at=None, raw="多频道老内容")

    KnowledgeStore(kstore.pool)   # 迁移在建库脚本里，每次初始化都跑（幂等）
    with kstore.pool.connection() as conn:
        rows = conn.execute("SELECT id, handle FROM contents WHERE id = ANY(%s)", ([a, b],)).fetchall()
    assert {r["id"]: r["handle"] for r in rows} == {a: "@only", b: None}


def test_v3_spec_problems_catch_what_used_to_fail_on_the_due_date():
    """v3：判据评分器解析不了的，导入时就拒绝（此前要到期那天才抛错，还拖停其后所有单元）。"""
    from fanisl.knowledge.scorers import spec_problems
    spec = {"method": "range_hold", "eval_ladder": ["2026-07-08"], "success_def": "t"}
    base = _claim(asset_symbol="WTI", direction="range", magnitude={"low": 66, "high": 70}, scoring_spec=spec)
    assert any("bounds" in m for m in spec_problems(base))                     # #1127 那一类
    assert spec_problems({**base, "scoring_spec": {**spec, "bounds": "low_only"}}) == []
    assert any("low 或 high" in m for m in spec_problems({**base, "magnitude": None}))   # #799 那一类
    touch = {"method": "target_touch", "eval_ladder": ["2026-07-08", "2026-07-31"], "success_def": "t"}
    assert any("target" in m for m in spec_problems(_claim(asset_symbol="WTI", scoring_spec=touch,
                                                           magnitude={"target": {"2026-07-08": 75}})))
    assert spec_problems(_claim(asset_symbol="WTI", scoring_spec=touch,
                                magnitude={"target": {"2026-07-08": 75, "2026-07-31": 78}})) == []
    assert any("日线序列" in m for m in spec_problems(_claim(asset_symbol="CL")))     # 别名不是日线符号
    cond = _claim(asset_symbol="WTI", condition_text="站住 70", condition_observable=True, verifiability="C")
    assert any("condition" in m for m in spec_problems(cond))


def test_v3_scorer_reads_machine_rules_from_the_spec(pool):
    import datetime as dt
    from fanisl.knowledge import scorers
    from fanisl.knowledge.models import KnowledgeUnit
    from fanisl.knowledge.prices import PriceStore
    ps = PriceStore(pool)
    with pool.connection() as conn:
        conn.execute("DELETE FROM daily_bars WHERE symbol IN ('WTI','KOSPI')")
    bars = [(dt.date(2026, 7, 1), 70, 70, 70, 70), (dt.date(2026, 7, 2), 70, 74, 70, 73),
            (dt.date(2026, 7, 3), 73, 75, 72, 74), (dt.date(2026, 7, 6), 74, 76, 67, 68),
            (dt.date(2026, 7, 7), 68, 69, 66, 66.5), (dt.date(2026, 7, 8), 66, 72, 66, 71)]
    ps.upsert("WTI", bars, "test")
    ps.upsert("KOSPI", bars, "test")
    L = dt.date(2026, 7, 8)
    rh = {"method": "range_hold", "eval_ladder": ["2026-07-08"], "benchmark": None, "success_def": "t"}
    # 双边 magnitude，判哪一边写在 spec 里。只判下沿 66.2：7/7 盘中 66 跌破、收 66.5 收回 → partial；
    # 双边都判：7/2 起收盘高于上沿 70 → miss
    u = _unit({"scoring_spec": {**rh, "bounds": "low_only"}, "direction": "range",
               "magnitude": {"low": 66.2, "high": 70}})
    assert scorers.score_unit_at(ps, u, L)[0] == "partial"
    u = _unit({"scoring_spec": {**rh, "bounds": "both"}, "direction": "range", "magnitude": {"low": 60, "high": 70}})
    assert scorers.score_unit_at(ps, u, L)[0] == "miss"
    # 按阶梯日分别给下沿
    u = _unit({"scoring_spec": rh, "direction": "range", "magnitude": {"low": {"2026-07-08": 65}}})
    assert scorers.score_unit_at(ps, u, L)[0] == "hit"
    # sign 的比较符与基准日写在 spec：7/8 收 71 > 7/3 收 74？否 → miss
    sg = {"method": "sign", "eval_ladder": ["2026-07-08"], "benchmark": None, "success_def": "t",
          "op": ">", "baseline_date": "2026-07-03"}
    assert scorers.score_unit_at(ps, _unit({"scoring_spec": sg}), L)[0] == "miss"

    # 说话前最近的收盘：12:00 UTC 发布 = 美东开盘前 → 前一交易日；韩股当日收盘早于正午 UTC
    pub = datetime(2026, 7, 6, 12, tzinfo=timezone.utc)
    assert scorers.pre_publication_close(ps, "WTI", pub) == (dt.date(2026, 7, 3), 74)
    assert scorers.pre_publication_close(ps, "KOSPI", pub) == (dt.date(2026, 7, 6), 68)

    # 空的 v3 字段不写进载荷；grade_note 有值时保留
    k = KnowledgeUnit(kind="claim", quote="q", payload=_claim())
    assert "bounds" not in k.payload["scoring_spec"] and "grade_note" not in k.payload
    k = KnowledgeUnit(kind="claim", quote="q", payload=_claim(grade_note="期限系我方指定"))
    assert k.payload["grade_note"] == "期限系我方指定"


def test_scorer_conditions_on_dates_cap_guard_and_race(pool, monkeypatch):
    """2026-09-24 补的三种写法：只看某几个交易日的条件、始终没站上的条件、先到先判的竞速。"""
    import datetime as dt
    from fanisl.knowledge import scorers
    from fanisl.knowledge.prices import PriceStore
    ps = PriceStore(pool)
    with pool.connection() as conn:
        conn.execute("DELETE FROM daily_bars WHERE symbol='WTI'")
    ps.upsert("WTI", [(dt.date(2026, 7, 1), 70, 70, 70, 70), (dt.date(2026, 7, 2), 70, 74, 70, 73),
                      (dt.date(2026, 7, 3), 73, 75, 72, 74), (dt.date(2026, 7, 6), 74, 76, 67, 68),
                      (dt.date(2026, 7, 7), 68, 69, 66, 66.5), (dt.date(2026, 7, 8), 66, 72, 66, 71)], "test")
    L = dt.date(2026, 7, 8)
    ov = lambda cfg: monkeypatch.setitem(scorers.OVERRIDES, "99999", cfg)
    # 只看 7/2 与 7/3 两天：收盘都 > 72 → 条件成立（成立日 7/3），之后按 sign up 评 → 71 >= 70 hit
    ov({"condition": {"type": "close_above", "level": 72, "dates": ["2026-07-02", "2026-07-03"]}})
    out, real = scorers.score_unit_at(ps, _unit({}), L)
    assert out == "hit" and real["cond_date"] == "2026-07-03"
    ov({"condition": {"type": "close_above", "level": 73.5, "dates": ["2026-07-02", "2026-07-03"]}})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "condition_not_met"      # 7/2 收 73 不满足
    # 始终没站上 75：期间最高收盘 74 → 成立；站上限改成 74 → 7/3 收 74 >= 74 失败
    ov({"condition": {"type": "guard_cap", "level": 75}})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "hit"
    ov({"condition": {"type": "guard_cap", "level": 74}})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "condition_not_met"
    # 竞速：7/3 高点 75 先触及 → hit；上方改 77（没触及）、下方收盘 67 → 7/7 收 66.5 先破 → miss
    ov({"mode": "race", "up_touch": 75, "down_close": 67})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "hit"
    ov({"mode": "race", "up_touch": 77, "down_close": 67})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "miss"
    ov({"mode": "race", "up_touch": 77, "down_close": 66.2})
    assert scorers.score_unit_at(ps, _unit({}), L)[0] == "partial"                 # 盘中破 66.2、收盘都在上方
