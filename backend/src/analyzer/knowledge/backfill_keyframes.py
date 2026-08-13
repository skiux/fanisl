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
from .store import LIVE_CONTENT, KnowledgeStore

# render_l0_text 写出的视觉笔记行：- [MM:SS] (kind) note
_NOTE_RE = re.compile(r"^-\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:\(([^)]*)\))?\s*(.*)$")
_VIDEO_ID_RE = re.compile(r"[?&]v=([A-Za-z0-9_-]{11})")
SLEEP_BETWEEN_S = 1.0

# 图表/表格：折线的形状、表格的格子，文字笔记天然装不下 → 帧永远有增量
_EVIDENCE_KINDS = {"chart", "table"}
# 精确数值 = 会被转录改写、且改写后无从发现的东西（小数/百分比/倍数万亿/货币/长整数）。
# 刻意排除孤立年份（"2026年"）——它是叙述而不是读数。gemini-3.5-flash-lite 把 SOX 的
# 19.94 倍转成 "9.94倍" 那次事故，正是这类数字，帧是唯一能翻案的凭据。
_PRECISE_NUM = re.compile(r"\d+\.\d+|\d+\s*%|\d+\s*[倍万亿]|[$￥]\s*\d+|(?<!\d)\d{4,}(?!\s*年)")


def worth_a_frame(kind: str | None, note: str | None) -> bool:
    """这一时刻值不值得存一张 1080p 的帧。

    判据只有一条：**帧能不能回答笔记回答不了的问题**。
    - chart / table → 能。留。
    - 笔记里有精确数值 → 能（数值可能被转录改写，帧是仲裁）。留。
    - 其余纯文字画面（章节标题卡、Logo、口号、手写板书）→ 不能。笔记就是那段文字本身，
      再打开帧看一遍不会多知道任何事。删。

    实测这条规则把三个信源砍成 39% / 94% / 83%——差异不是配额调出来的，是信源形态不同：
    美投君是剪辑过的视频论文（标题卡、手绘板书、B-roll），Andy 和投资TALK君是直接投屏看盘。
    刻意不做关键词广告过滤：'Pro' 会命中 Procore，'订阅' 会命中"FSD订阅用户由128万增加到
    148万"，误删一张真实数据图的代价远大于留几张推广图。带数值的推广页会漏网，认了。
    """
    if kind in _EVIDENCE_KINDS:
        return True
    return bool(_PRECISE_NUM.search(note or ""))


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
    # 先按 worth_a_frame 筛，再去下载——省的是带宽，不只是磁盘
    notes = {n["ts_s"]: n for n in visual_notes(content["raw"])
             if worth_a_frame(n["kind"], n["note"])}
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


def prune(store: KnowledgeStore, *, dry_run: bool = True, root=None) -> dict:
    """按 worth_a_frame 清理存量帧（规则是 2026-08-14 才定的，之前抓的是全量）。

    删文件前必须确认没有别的 keyframe 行还引用同一路径：文件按 video_id/秒 命名，
    重转录产生的 superseded 旧稿与取代它的新稿**共用同一批文件**，只按 content 删行
    会把还在用的图删掉。

    `root` 指向 data_export（默认由 `__file__` 推出来）。**git worktree 里必须显式传**：
    data_export 是 gitignore 的数据目录，只存在于主工作区，而 OUT_DIR 从 __file__ 推导
    会指向 worktree 里那个根本不存在的路径。不加下面这道闸的话，删库行会成功、删文件会
    静默跳过（f.exists() 恒为 False），结果是文件全成孤儿、一点空间没省。
    """
    base = (root or OUT_DIR.parent)
    if not (base / "keyframes").is_dir():
        raise SystemExit(
            f"找不到帧目录 {base / 'keyframes'}——大概是在 git worktree 里跑的。"
            f"用 --root 指向主工作区的 data_export，否则只会删库不删文件。")
    with store.pool.connection() as conn:
        rows = conn.execute("SELECT id, content_id, kind, note, path, bytes FROM keyframes").fetchall()
        doomed = [r for r in rows if not worth_a_frame(r["kind"], r["note"])]
        keep_paths = {r["path"] for r in rows if worth_a_frame(r["kind"], r["note"])}
        stat = {"total": len(rows), "drop_rows": len(doomed),
                "keep_rows": len(rows) - len(doomed),
                "freed_mb": round(sum(r["bytes"] or 0 for r in doomed) / 1048576, 1),
                "files_deleted": 0, "files_shared_kept": 0}
        if dry_run:
            return stat
        for r in doomed:
            conn.execute("DELETE FROM keyframes WHERE id=%s", (r["id"],))
            if r["path"] in keep_paths:          # 同一文件仍被保留的行引用
                stat["files_shared_kept"] += 1
                continue
            f = base / r["path"]
            if f.exists():
                f.unlink()
                stat["files_deleted"] += 1
    return stat


def fill_gaps(store: KnowledgeStore, *, limit: int = 20,
              height: int = DEFAULT_HEIGHT) -> int:
    """补一批"一帧都没有"的内容（日维护用）。返回新增帧数。

    主要针对墙起来时摄取的那批：当时提帧整条失败，墙落下后这里自动补上。限量是为了
    别让日维护变成一跑几小时的批处理——真要成批补就手动跑 CLI。
    解析失败直接抛给调用方（daily 会记 log）：墙还立着时，20 条挨个撞墙没有意义。
    """
    with store.pool.connection() as conn:
        rows = conn.execute(
            f"SELECT c.id, c.url, c.title, c.raw FROM contents c "
            f"WHERE c.platform='youtube' AND c.content_type='video' "
            f"AND {LIVE_CONTENT} "   # 旧稿的帧由取代它的那条负责，不重抓
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
        conds.append(LIVE_CONTENT)
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
    ap.add_argument("--dry-run", action="store_true", help="只统计，不抓/不删")
    ap.add_argument("--prune", action="store_true",
                    help="按 worth_a_frame 清理存量帧（规则定之前抓的是全量）")
    ap.add_argument("--root", help="data_export 目录；在 git worktree 里跑 --prune 时必须指定")
    a = ap.parse_args()
    if a.prune:
        import pathlib
        pool = make_pool(get_settings().pg_knowledge_conninfo)
        try:
            st = prune(KnowledgeStore(pool), dry_run=a.dry_run,
                       root=pathlib.Path(a.root).resolve() if a.root else None)
            verb = "预计删" if a.dry_run else "已删"
            print(f"存量 {st['total']} 帧：{verb} {st['drop_rows']}，留 {st['keep_rows']}"
                  f"，释放约 {st['freed_mb']} MB")
            if not a.dry_run:
                print(f"  实删文件 {st['files_deleted']}，"
                      f"因与保留行共用而保留的文件 {st['files_shared_kept']}")
        finally:
            pool.close()
        return
    run(handle=a.handle, content_id=a.content_id, limit=a.limit, height=a.height,
        workers=a.workers, dry_run=a.dry_run)


if __name__ == "__main__":
    main()
