"""关键帧精简：去空白、合并重复（留后一张）、只留有数据的画面，Gemini 判不了时退回前两步。"""

import random
from datetime import datetime, timezone

import pytest

from fanisl.knowledge import frame_filter as ff
from fanisl.knowledge.store import KnowledgeStore


@pytest.fixture
def kstore(pool):
    st = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, "
                     "knowledge_units, claim_scores, spot_checks, keyframes RESTART IDENTITY CASCADE")
    return st


def _thumb(seed: int, n: int = 72) -> bytes:
    """一张有起伏的灰度缩略图（n 字节）；seed 不同，dHash 相差约一半的位。"""
    r = random.Random(seed)
    return bytes(r.randint(20, 230) for _ in range(n))


def _from_bits(bits: list[bool], w: int, h: int) -> bytes:
    """按给定的 dHash 位造一张 w×h 缩略图：位为真，下一格比这一格暗。"""
    out = []
    for r in range(h):
        v = 128
        out.append(v)
        for c in range(w - 1):
            v += -3 if bits[r * (w - 1) + c] else 3
            out.append(v)
    return bytes(out)


def _flip(n_bits: int, n: int) -> list[bool]:
    return [i < n for i in range(n_bits)]


def _patch_thumbs(monkeypatch, coarse, fine=None):
    """粗（9×8）、细（33×32）缩略图分开给。元素是 seed、None（白屏）或现成的 bytes；fine 缺省同 coarse。"""
    def thumbs(paths, w=9, h=8):
        return [x if isinstance(x, bytes) else bytes([250] * (w * h)) if x is None else _thumb(x, w * h)
                for x in (coarse if (w, h) == (9, 8) else fine or coarse)]
    monkeypatch.setattr(ff, "_thumbs", thumbs)


def _files(tmp_path, n):
    out = []
    for i in range(n):
        f = tmp_path / f"{i * 3:05d}s_h1080.jpg"
        f.write_bytes(b"jpg")
        out.append(f)
    return out


def test_blank_and_repeats_dropped_keeping_the_last_of_a_run(monkeypatch, tmp_path):
    files = _files(tmp_path, 5)
    _patch_thumbs(monkeypatch, [None, 1, 1, 2, 2])
    sel = ff.select(files, client=None)
    assert [p for p, _ in sel.keep] == [files[2], files[4]]          # 一串相同的留最后一张（最完整）
    assert sel.drop[files[0]] == "空白" and not sel.classified


def test_gemini_drops_frames_without_data_and_writes_notes(monkeypatch, tmp_path):
    files = _files(tmp_path, 3)
    _patch_thumbs(monkeypatch, [1, 2, 3])
    monkeypatch.setattr(ff, "classify", lambda client, paths: {
        paths[0]: {"keep": True, "kind": "chart", "note": "SPX 4 小时 K 线 7551"},
        paths[1]: {"keep": False, "kind": "other"},
        paths[2]: {"keep": True, "kind": "table", "note": ""}})
    sel = ff.select(files, client=object())
    assert sel.keep == [(files[0], "SPX 4 小时 K 线 7551"), (files[2], "table")]
    assert sel.drop[files[1]] == "没有数据" and sel.classified


def test_same_template_different_pages_are_not_merged(monkeypatch, tmp_path):
    """9×8 分不开同一版式的不同页（c218 两页 OpenAI 总结只差 4 位），33×32 不像就不并。"""
    files = _files(tmp_path, 2)
    _patch_thumbs(monkeypatch, coarse=[1, 1], fine=[1, 2])
    assert [p for p, _ in ff.select(files, client=None).keep] == files


def test_loose_merge_needs_the_fine_hash_to_agree_too(monkeypatch, tmp_path):
    files = _files(tmp_path, 3)
    c = [_from_bits(_flip(64, n), 9, 8) for n in (0, 8, 0)]                          # 相邻差 8 位：第 2 步不并
    f = [_from_bits(_flip(1024, n), ff.FINE_W, ff.FINE_H) for n in (0, 100, 300)]    # 细 dHash 差 100、200
    _patch_thumbs(monkeypatch, c, f)
    monkeypatch.setattr(ff, "classify", lambda client, paths: {p: {"keep": True, "kind": "chart"} for p in paths})
    sel = ff.select(files, client=object())
    assert [p for p, _ in sel.keep] == files[1:]
    assert sel.drop == {files[0]: "与后一张是同一张图"}


def test_classify_retries_on_503_then_keeps_unanswered_frames(monkeypatch, tmp_path):
    import httpx
    files = _files(tmp_path, 2)
    monkeypatch.setattr(ff, "_small_jpeg", lambda p: b"x")
    monkeypatch.setattr(ff, "RETRY_PAUSE_S", 0)
    calls = []

    class _Client:
        def generate_json(self, parts, schema):
            calls.append(len(parts))
            if len(calls) == 1:
                req = httpx.Request("POST", "https://g")
                raise httpx.HTTPStatusError("503", request=req, response=httpx.Response(503, request=req))
            assert "inline_data" in parts[0]
            return {"frames": [{"i": 0, "keep": False, "kind": "other"}]}    # 第 2 张没返回

    out = ff.classify(_Client(), files)
    assert len(calls) == 2
    assert out[files[0]]["keep"] is False and out[files[1]]["keep"] is True    # 没返回的保守留下


def test_fallback_keeps_dedup_only_when_gemini_fails(monkeypatch, tmp_path):
    files = _files(tmp_path, 2)
    _patch_thumbs(monkeypatch, [1, 2])

    def _boom(client, paths):
        raise RuntimeError("429")

    monkeypatch.setattr(ff, "classify", _boom)
    sel = ff.select_or_fallback(files, client=object())
    assert [p for p, _ in sel.keep] == files and not sel.classified


def test_filter_pending_deletes_dropped_rows_and_files_but_keeps_shared_ones(kstore, monkeypatch, tmp_path):
    root = tmp_path / "data" / "keyframes"
    (root / "vidA").mkdir(parents=True)
    monkeypatch.setattr(ff, "keyframe_root", lambda: root)
    creator = kstore.ensure_creator("测试创作者")
    cid, _ = kstore.upsert_content(creator, platform="youtube", url="https://www.youtube.com/watch?v=vidA0000000",
                                   content_type="video", title="一期", raw="正文",
                                   published_at=datetime(2026, 9, 1, tzinfo=timezone.utc))
    other, _ = kstore.upsert_content(creator, platform="youtube", url="https://y/other", content_type="video",
                                     title="旧稿", raw="旧稿正文", published_at=None)
    for sec in (0, 3, 6):
        (root / "vidA" / f"{sec:05d}s_h1080.jpg").write_bytes(b"jpg")
        kstore.record_keyframe(cid, ts_s=sec, path=f"keyframes/vidA/{sec:05d}s_h1080.jpg", height=1080,
                               bytes_=3, source="ytdlp:default:scene", kind="scene")
    # 被取代的旧稿共用 3 秒那张文件：删行可以，删文件不行
    kstore.record_keyframe(other, ts_s=3, path="keyframes/vidA/00003s_h1080.jpg", height=1080,
                           bytes_=3, source="ytdlp:default:scene", kind="scene", filtered=True)
    f0, f3, f6 = (root / "vidA" / f"{s:05d}s_h1080.jpg" for s in (0, 3, 6))
    monkeypatch.setattr(ff, "select", lambda files, client=None: ff.Selection(
        [(f6, "铜油比周线 0.0640")], {f0: "空白", f3: "没有数据"}, True))
    st = ff.filter_pending(kstore, client=object())
    assert (st["before"], st["after"]) == (3, 1)
    rows = kstore.keyframes_for_content(cid)
    assert [(r["ts_s"], r["note"]) for r in rows] == [(6, "铜油比周线 0.0640")] and rows[0]["filtered_at"]
    assert not f0.exists() and f3.exists() and f6.exists()
    assert ff.filter_pending(kstore, client=object())["contents"] == 0      # 已精简过的不再处理


def test_filter_pending_refuses_without_frame_directory(kstore, monkeypatch, tmp_path):
    """没有帧目录的机器上，每个文件都"不存在"——不能据此删行；也不能用 SystemExit（会结束调度线程）。"""
    monkeypatch.setattr(ff, "keyframe_root", lambda: tmp_path / "nope" / "keyframes")
    with pytest.raises(FileNotFoundError):
        ff.filter_pending(kstore, client=object())


def test_vertex_request_uses_camel_case_inline_data():
    from fanisl.knowledge.llm import _camelize
    assert _camelize([{"inline_data": {"mime_type": "image/jpeg", "data": "x"}}]) == \
        [{"inlineData": {"mimeType": "image/jpeg", "data": "x"}}]
