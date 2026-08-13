"""视觉笔记时间戳 → 关键帧回填：给"画面上写了什么"的文字记录配上可核验的像素。

用法：python -m analyzer.knowledge.backfill_keyframes [--handle @x] [--content-id N]
      [--limit N] [--height 1080] [--workers 4] [--dry-run]

时间戳取自 L0 raw 的视觉笔记行（render_l0_text 的 `- [MM:SS] (kind) note` 约定），
只处理 platform=youtube 的视频内容。幂等：keyframes 表里已有的 (content, ts) 跳过，
磁盘上已存在的文件不重抓——所以中断后原地重跑即可。

抓下来的帧同时服务两件事：抽查视觉笔记的读数忠实度（Gemini 报的表格数字无从核对是
K6 抽查现存的缺口），以及视频被删后画面信息的唯一像素留存。
"""

from __future__ import annotations

import argparse
import re
import time

from ..config import get_settings
from ..db import make_pool
from .keyframes import DEFAULT_HEIGHT, OUT_DIR, grab
from .store import KnowledgeStore

# render_l0_text 写出的视觉笔记行：- [MM:SS] (kind) note
_NOTE_RE = re.compile(r"^-\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:\(([^)]*)\))?\s*(.*)$")
_VIDEO_ID_RE = re.compile(r"[?&]v=([A-Za-z0-9_-]{11})")
SLEEP_BETWEEN_S = 1.0


def _to_seconds(ts: str) -> int:
    parts = [int(x) for x in ts.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def visual_notes(raw: str) -> list[dict]:
    """L0 原文 → [{ts_s, kind, note}]（同秒多条笔记合并成一条，一秒只需一帧）。"""
    merged: dict[int, dict] = {}
    for line in raw.splitlines():
        m = _NOTE_RE.match(line.strip())
        if not m:
            continue
        sec = _to_seconds(m.group(1))
        note = (m.group(3) or "").strip()
        if sec in merged:
            merged[sec]["note"] = f"{merged[sec]['note']} / {note}".strip(" /")
        else:
            merged[sec] = {"ts_s": sec, "kind": (m.group(2) or None), "note": note}
    return [merged[k] for k in sorted(merged)]


def grab_for_content(store: KnowledgeStore, content: dict, *, height: int = DEFAULT_HEIGHT,
                     workers: int = 4) -> int:
    """一条内容的提帧+记账（幂等）。返回新增/更新的帧数。摄取链上 best-effort 调用。"""
    video_id_m = _VIDEO_ID_RE.search(content.get("url") or "")
    if not video_id_m:
        return 0
    notes = {n["ts_s"]: n for n in visual_notes(content["raw"])}
    todo = sorted(set(notes) - store.keyframe_seconds(content["id"]))
    if not todo:
        return 0
    n = 0
    for f in grab(video_id_m.group(1), todo, max_height=height, workers=workers):
        note = notes.get(f.ts_s, {})
        store.record_keyframe(content["id"], ts_s=f.ts_s,
                              path=str(f.path.relative_to(OUT_DIR.parent)),
                              height=f.height, bytes_=f.bytes, source=f.source,
                              kind=note.get("kind"), note=note.get("note"))
        n += 1
    return n


def fill_gaps(store: KnowledgeStore, *, limit: int = 20,
              height: int = DEFAULT_HEIGHT) -> int:
    """补一批"一帧都没有"的内容（日维护用）。返回新增帧数。

    主要针对墙起来时摄取的那批：当时提帧整条失败，墙落下后这里自动补上。限量是为了
    别让日维护变成一跑几小时的批处理——真要成批补就手动跑 CLI。
    解析失败直接抛给调用方（daily 会记 log）：墙还立着时，20 条挨个撞墙没有意义。
    """
    with store.pool.connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.url, c.title, c.raw FROM contents c "
            "WHERE c.platform='youtube' AND c.content_type='video' "
            "AND c.status <> 'superseded' "   # 旧稿的帧由取代它的那条负责，不重抓
            "AND NOT EXISTS (SELECT 1 FROM keyframes k WHERE k.content_id=c.id) "
            "ORDER BY c.published_at DESC NULLS LAST LIMIT %s", (limit,)).fetchall()
    return sum(grab_for_content(store, c, height=height) for c in rows)


def run(*, handle: str | None = None, content_id: int | None = None, limit: int | None = None,
        height: int = DEFAULT_HEIGHT, workers: int = 4, dry_run: bool = False) -> None:
    s = get_settings()
    pool = make_pool(s.pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        contents = _select_contents(store, handle=handle, content_id=content_id, limit=limit)
        print(f"待处理内容 {len(contents)} 条（清晰度 h{height}，并发 {workers}）", flush=True)
        n_frames = n_done = 0
        for i, c in enumerate(contents, 1):
            notes = visual_notes(c["raw"])
            have = store.keyframe_seconds(c["id"])
            todo = [n for n in notes if n["ts_s"] not in have]
            head = f"  [{i}/{len(contents)}] #{c['id']} {(c['title'] or '')[:34]}"
            if dry_run:
                print(f"{head}  笔记 {len(notes)}，待抓 {len(todo)}", flush=True)
                n_frames += len(todo)
                continue
            if not todo:
                n_done += 1
                continue
            t0 = time.time()
            try:
                got = grab_for_content(store, c, height=height, workers=workers)
            except Exception as e:  # noqa: BLE001 — 单条失败不中断整轮回填
                print(f"{head}  失败：{str(e)[:120]}", flush=True)
                continue
            n_frames += got
            print(f"{head}  +{got}/{len(todo)} 帧  {time.time() - t0:.0f}s", flush=True)
            time.sleep(SLEEP_BETWEEN_S)
        verb = "预计抓" if dry_run else "新增"
        print(f"完成：{verb} {n_frames} 帧，{n_done} 条内容已齐", flush=True)
    finally:
        pool.close()


def _select_contents(store: KnowledgeStore, *, handle: str | None, content_id: int | None,
                     limit: int | None) -> list[dict]:
    conds, params = ["c.platform='youtube'", "c.content_type='video'"], []
    if content_id:
        conds.append("c.id=%s")
        params.append(content_id)
    else:                                     # 点名某条时照抓；批量时跳过被取代的旧稿
        conds.append("c.status <> 'superseded'")
    if handle:
        conds.append("EXISTS (SELECT 1 FROM creator_handles h WHERE h.creator_id=c.creator_id "
                     "AND h.handle=%s)")
        params.append(handle)
    sql = (f"SELECT c.id, c.url, c.title, c.raw FROM contents c WHERE {' AND '.join(conds)} "
           f"ORDER BY c.published_at DESC NULLS LAST")
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    with store.pool.connection() as conn:
        return conn.execute(sql, tuple(params)).fetchall()


def main() -> None:
    ap = argparse.ArgumentParser(description="按视觉笔记时间戳回填关键帧")
    ap.add_argument("--handle", help="只跑某个信源（如 @MeiTouJun）")
    ap.add_argument("--content-id", type=int)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true", help="只统计待抓帧数，不抓")
    a = ap.parse_args()
    run(handle=a.handle, content_id=a.content_id, limit=a.limit, height=a.height,
        workers=a.workers, dry_run=a.dry_run)


if __name__ == "__main__":
    main()
