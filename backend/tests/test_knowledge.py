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
    # 列表视图：带信源名/字数/单元数，不含 raw 全文
    rows = kstore.list_contents()
    assert rows[0]["creator"] == "测试创作者" and rows[0]["n_units"] == 2
    assert rows[0]["raw_len"] > 0 and "raw" not in rows[0]


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
