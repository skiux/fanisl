"""关键帧接口：locator 解析、越界告警、读图的路径约束（不联网、不碰真库）。"""

import pytest

from analyzer.main import _locator_seconds


# --- locator 解析：提取时是模型写的自由文本，解析不出来要给 None 而不是抛 ---

@pytest.mark.parametrize("raw, want", [
    ("06:29", 389),
    ("45:12", 2712),
    ("1:02:03", 3723),
    ("00:00", 0),
])
def test_locator_parses_timestamps(raw, want):
    assert _locator_seconds(raw) == want


@pytest.mark.parametrize("raw", [
    None, "", "空",
    "第 1234 字符",     # locator 也可能是字符偏移
    "99:99",            # 秒必须 0-59
    "7:5",              # 秒必须两位
])
def test_locator_returns_none_when_unparseable(raw):
    assert _locator_seconds(raw) is None


def test_locator_picks_timestamp_out_of_surrounding_text():
    assert _locator_seconds("视觉笔记 06:29 处") == 389


# --- 越界告警：locator 可能是模型虚构的 ------------------------------------

class _FakeStore:
    """只实现被 knowledge_unit_keyframes 用到的那几个方法。"""

    def __init__(self, *, locator, span, frames=()):
        self._locator, self._span, self._frames = locator, span, list(frames)

    def unit_detail(self, unit_id):
        return {"id": unit_id, "content_id": 2, "locator": self._locator}

    def keyframe_span(self, content_id):
        return self._span

    def keyframes_near(self, content_id, ts_s, *, window_s):
        return [f for f in self._frames if abs(f["ts_s"] - ts_s) <= window_s]


def _call(monkeypatch, store):
    import analyzer.main as m
    monkeypatch.setattr(m, "knowledge_store", store)
    return m.knowledge_unit_keyframes(15)


def test_locator_beyond_frame_span_warns_about_fabrication(monkeypatch):
    """unit #15 实例：locator 45:12，而 c2 片长只有 25:57。"""
    out = _call(monkeypatch, _FakeStore(locator="45:12", span=(112, 1220)))
    assert out["locator_s"] == 2712
    assert out["frames"] == []
    assert "虚构" in out["warning"] and "quote" in out["warning"]


def test_no_frames_nearby_is_reported_differently_from_fabrication(monkeypatch):
    """时刻在片长内但没帧——是按判据没抓，不是时间戳有问题，措辞必须区分开。"""
    out = _call(monkeypatch, _FakeStore(locator="05:00", span=(112, 1220)))
    assert out["frames"] == []
    assert "虚构" not in out["warning"]
    assert "未抓" in out["warning"]


def test_unparseable_locator_is_explained_not_silently_empty(monkeypatch):
    out = _call(monkeypatch, _FakeStore(locator=None, span=(112, 1220)))
    assert out["locator_s"] is None
    assert "时间戳" in out["warning"]


def test_frames_within_window_are_returned(monkeypatch):
    frames = [{"ts_s": 276, "note": "SOX 19.9418"}, {"ts_s": 900, "note": "远处"}]
    out = _call(monkeypatch, _FakeStore(locator="05:10", span=(7, 1081), frames=frames))
    assert [f["ts_s"] for f in out["frames"]] == [276]
    assert out["warning"] is None


# --- 读图：路径来自库、不接受调用方传路径 ----------------------------------

def test_image_route_takes_an_id_not_a_path():
    """签名里只有 keyframe_id:int——没有能拼进文件系统路径的入参，穿越无从谈起。"""
    import inspect
    import typing

    from analyzer.main import knowledge_keyframe_image

    params = inspect.signature(knowledge_keyframe_image).parameters
    assert list(params) == ["keyframe_id"]
    # main.py 有 from __future__ import annotations，注解是字符串，得求值回来
    assert typing.get_type_hints(knowledge_keyframe_image)["keyframe_id"] is int
