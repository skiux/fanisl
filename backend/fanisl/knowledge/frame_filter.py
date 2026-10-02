"""关键帧精简：整片取帧之后，只留对核对事实有用的画面。

用户 2026-10-01：美投君一期 150 多张，分析提取时看不过来，没用的尽量精简。四步：
1. 去空白帧：9×8 灰度均值极暗或极亮、且几乎没有起伏（转场白屏、黑屏）。
2. 相邻几乎重复只留后一张（dHash 距离 ≤ STRICT_BITS）：逐步画完的手绘、只换了字幕、淡入。
   留后一张，是因为手绘与逐条出现的列表，最后一张最完整。
   9×8 的 dHash 分不开同一版式的不同页，所以还要 33×32 的 dHash（1024 位）也相近（≤ FINE_STRICT_BITS）
   才合并。2026-10-02 实测：TALK君 c218 两页 OpenAI 总结 9×8 只差 4 位、被并掉一页，33×32 差 247 位（24%）；
   加红框、换右下角人像只差 0.9%-2.0%，片头动画 3%，文字逐行出现的半成品 17%。
3. Gemini 逐张判有没有数据：图表、表格、具体数字留下，并把一句说明（标的、图表类型、周期，**不含数字**——
   flash-lite 抄数会错，2026-10-01 实测把屏上的 2000 亿写成 200 亿；数字一律以原图为准）写进 keyframes.note；
   插画、人物、素材照片、只有作者自己观点的文字页、广告与频道推广去掉。新闻、社媒、研报、官员讲话、
   财报会要点的截图即使没有数字也留：它们是事实层的来源（2026-10-02：原提示词下 TALK君 c222 的
   美联储副主席讲话推文、洛根讲话的彭博摘要、作者的财报会笔记都被判成没有数据，且同一张图两次判得不一样）。用 flash-lite：只判
   "有没有数据"、不让它读数（它转录会丢数字），8 张一批约 4 秒；flash 同样的批量 2026-10-01
   在 AI Studio 连续 503、在 Vertex 超时与 429。
4. 留下的相邻帧按放宽的距离（≤ LOOSE_BITS，33×32 ≤ FINE_LOOSE_BITS）再合并一次：手在画面里移动，
   同一张图的半成品第 2 步并不掉。阈值再松会开始把版式相近的不同图表并掉。

实测（2026-10-01）：美投君 c105 192 → 24 张（空白 2、几乎相同 41、没有数据 114、同一张图 11），65s；
Andy c123 37 → 34 张（看盘录屏几乎全是图表，只并掉 3 张同一张图）。

Gemini 判不了（限流、服务不可用）时不阻塞：只做 1、2 两步，帧标为待精简（filtered_at 为空），
日维护的 filter_pending 之后补判。

用法：python -m fanisl.knowledge.frame_filter [--content-id N] [--limit N] [--dry-run]
"""

from __future__ import annotations

import argparse
import base64
import pathlib
import subprocess
import tempfile
import time
from dataclasses import dataclass, field

import httpx

from ..config import get_settings
from ..db import make_pool
from .keyframes import keyframe_root
from .llm import TruncatedGeneration, make_client
from .store import KnowledgeStore

FILTER_MODEL = "gemini-3.5-flash-lite"
BATCH = 8                 # 一次请求几张图
SEND_WIDTH = 512          # 送判时缩到的宽度：判"有没有数据"够了，token 约为原图的五分之一
STRICT_BITS = 5           # 第 2 步：相邻两张 64 位 dHash 相差不超过它算同一画面
LOOSE_BITS = 10           # 第 4 步：留下的相邻帧放宽到这个距离再合并
FINE_W, FINE_H = 33, 32   # 复核用的细 dHash：1024 位，分得开同一版式的不同页
FINE_STRICT_BITS = 80     # 第 2 步的细 dHash 上限（约 8%）
FINE_LOOSE_BITS = 160     # 第 4 步的细 dHash 上限（约 16%）
RETRIES = 4
RETRY_PAUSE_S = 20.0

PROMPT = """下面是一期财经视频里按画面变化截下的 {n} 张图，按顺序编号 0 到 {last}。逐张判断：这张图对核对视频里的事实和数据有没有用。
保留（keep=true）：价格或指标走势图、数据图表、表格、带具体数字的画面（价格、百分比、财务数据、估值、带数值的日期）；新闻、社交媒体帖子、研报、官员讲话或公告、财报会要点的截图，即使没有数字也保留；作者整理的要点页，只要里面有具体数字。
不保留（keep=false）：人物出镜；没有具体数字的插画、漫画、示意图；素材照片（人拿着图表、装饰性的行情画面、看不清数字的图表照片）；Logo、片头片尾；只有标题或作者自己观点、既没有数字也不是引用第三方的文字页；广告与推广（包括频道自己的会员、课程推广，即使有数字）；转场或空白画面。
对保留的图，用一句中文（不超过 30 字）写它展示的是什么：标的或主题、图表类型、周期。不要抄写数字（数字以原图为准）。"""

SCHEMA = {
    "type": "OBJECT",
    "properties": {"frames": {"type": "ARRAY", "items": {
        "type": "OBJECT",
        "properties": {
            "i": {"type": "INTEGER"},
            "keep": {"type": "BOOLEAN"},
            "kind": {"type": "STRING", "enum": ["chart", "table", "numbers", "other"]},
            "note": {"type": "STRING"},
        },
        "required": ["i", "keep", "kind"],
    }}},
    "required": ["frames"],
}


@dataclass
class Selection:
    keep: list[tuple[pathlib.Path, str | None]]                       # (文件, 说明)；没经 Gemini 判时说明为 None
    drop: dict[pathlib.Path, str] = field(default_factory=dict)       # 文件 → 去掉的原因
    classified: bool = False                                          # 是否经过 Gemini（第 3、4 步）


def make_filter_client():
    return make_client(get_settings(), model=FILTER_MODEL)


def _thumbs(paths: list[pathlib.Path], w: int = 9, h: int = 8) -> list[bytes]:
    """一次 ffmpeg 把这批图缩成 w×h 灰度，按顺序每张 w*h 字节。"""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write("".join(f"file '{p}'\n" for p in paths))
        lst = f.name
    try:
        raw = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
             "-vf", f"scale={w}:{h}:flags=area,format=gray", "-f", "rawvideo", "-"],
            capture_output=True, check=True, timeout=600).stdout
    finally:
        pathlib.Path(lst).unlink(missing_ok=True)
    n = w * h
    out = [raw[i * n:(i + 1) * n] for i in range(len(raw) // n)]
    if len(out) != len(paths):
        raise RuntimeError(f"缩略图 {len(paths)} 张只解出 {len(out)} 张")
    return out


def _dhash(t: bytes, w: int = 9, h: int = 8) -> int:
    v = 0
    for r in range(h):
        for c in range(w - 1):
            v = (v << 1) | (t[r * w + c] > t[r * w + c + 1])
    return v


def _is_blank(t: bytes) -> bool:
    mean = sum(t) / len(t)
    return (mean < 12 or mean > 243) and max(t) - min(t) < 25


def _collapse(items: list[tuple[pathlib.Path, tuple[int, int]]], bits: tuple[int, int], drop: dict, reason: str):
    """相邻两张粗、细 dHash 的距离都不超过 bits 时去掉前一张（一串相近的只留最后一张）。"""
    kept = []
    for i, (p, h) in enumerate(items):
        if i + 1 < len(items) and all(bin(a ^ b).count("1") <= n for a, b, n in zip(h, items[i + 1][1], bits)):
            drop[p] = reason
        else:
            kept.append((p, h))
    return kept


def _small_jpeg(p: pathlib.Path) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(p), "-vf", f"scale={SEND_WIDTH}:-2",
         "-q:v", "5", "-f", "mjpeg", "-"], capture_output=True, check=True, timeout=60).stdout


def _generate(client, parts: list[dict]) -> dict:
    for attempt in range(RETRIES):
        try:
            return client.generate_json(parts, SCHEMA)
        except (httpx.TimeoutException, httpx.TransportError, TruncatedGeneration) as e:
            err = e
        except httpx.HTTPStatusError as e:
            if e.response.status_code not in (429, 500, 502, 503, 504):
                raise
            err = e
        if attempt + 1 < RETRIES:
            time.sleep(RETRY_PAUSE_S * (attempt + 1))
    raise err


def classify(client, paths: list[pathlib.Path]) -> dict[pathlib.Path, dict]:
    """Gemini 逐张判有没有数据。没返回的那张保守留下。"""
    out: dict[pathlib.Path, dict] = {}
    for s in range(0, len(paths), BATCH):
        batch = paths[s:s + BATCH]
        parts = [{"inline_data": {"mime_type": "image/jpeg",
                                  "data": base64.b64encode(_small_jpeg(p)).decode()}} for p in batch]
        parts.append({"text": PROMPT.format(n=len(batch), last=len(batch) - 1)})
        for f in _generate(client, parts).get("frames", []):
            if 0 <= f.get("i", -1) < len(batch):
                out[batch[f["i"]]] = f
    for p in paths:
        out.setdefault(p, {"keep": True, "kind": "other", "note": ""})
    return out


def select(paths: list[pathlib.Path], *, client=None) -> Selection:
    """四步精简（见模块顶注）。client 为 None 时只做前两步。Gemini 失败时抛给调用方。"""
    paths = sorted(paths)
    if not paths:
        return Selection([], {}, client is not None)
    drop: dict[pathlib.Path, str] = {}
    stage = []
    for p, t, f in zip(paths, _thumbs(paths), _thumbs(paths, FINE_W, FINE_H)):
        if _is_blank(t):
            drop[p] = "空白"
        else:
            stage.append((p, (_dhash(t), _dhash(f, FINE_W, FINE_H))))
    stage = _collapse(stage, (STRICT_BITS, FINE_STRICT_BITS), drop, "与后一张几乎相同")
    if client is None:
        return Selection([(p, None) for p, _ in stage], drop, False)
    verdict = classify(client, [p for p, _ in stage])
    kept = []
    for p, h in stage:
        if verdict[p].get("keep"):
            kept.append((p, h))
        else:
            drop[p] = "没有数据"
    kept = _collapse(kept, (LOOSE_BITS, FINE_LOOSE_BITS), drop, "与后一张是同一张图")
    return Selection([(p, (verdict[p].get("note") or verdict[p].get("kind") or "").strip() or None)
                      for p, _ in kept], drop, True)


def select_or_fallback(paths: list[pathlib.Path], *, client=None) -> Selection:
    """摄取链用：Gemini 判不了就只做前两步，帧留待日维护补判。"""
    try:
        return select(paths, client=client or make_filter_client())
    except Exception as e:  # noqa: BLE001 — 精简失败不能挡住提帧
        print(f"    帧精简的 Gemini 判断失败，先只去空白与重复：{str(e)[:100]}", flush=True)
        return select(paths, client=None)


def delete_files(store: KnowledgeStore, files: list[pathlib.Path]) -> int:
    """删帧文件；库里仍有行引用同一路径的不删（重转录的新旧稿共用同一批文件）。"""
    root = keyframe_root()
    n = 0
    with store.pool.connection() as conn:
        for f in files:
            rel = str(f.relative_to(root.parent)) if f.is_relative_to(root.parent) else None
            if rel and conn.execute("SELECT 1 FROM keyframes WHERE path=%s LIMIT 1", (rel,)).fetchone():
                continue
            if f.exists():
                f.unlink()
                n += 1
    return n


def filter_pending(store: KnowledgeStore, *, limit: int | None = None, content_id: int | None = None,
                   dry_run: bool = False, client=None) -> dict:
    """精简还有待精简帧的内容（日维护与 CLI 用）。一条内容 Gemini 失败就跳过，留到下次。"""
    root = keyframe_root()
    if not root.is_dir():
        # 在没有帧文件的机器上跑（例如本机没配 keyframe_root），每个文件都"不存在"——绝不能据此删库里的行
        # 不用 SystemExit：日维护在调度线程里调用它，SystemExit 会穿过 except Exception 结束整条线程
        raise FileNotFoundError(f"找不到帧目录 {root}；在帧文件所在的机器上跑，或配置 keyframe_root")
    conds, params = ["k.filtered_at IS NULL"], []
    if content_id:
        conds.append("k.content_id=%s")
        params.append(content_id)
    sql = (f"SELECT c.id FROM contents c WHERE EXISTS (SELECT 1 FROM keyframes k WHERE k.content_id=c.id "
           f"AND {' AND '.join(conds)}) ORDER BY c.published_at DESC NULLS LAST")
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    with store.pool.connection() as conn:
        cids = [r["id"] for r in conn.execute(sql, tuple(params)).fetchall()]
    stat = {"contents": 0, "before": 0, "after": 0, "files_deleted": 0, "failed": 0}
    client = client or (None if dry_run else make_filter_client())
    for cid in cids:
        with store.pool.connection() as conn:
            rows = conn.execute("SELECT id, path FROM keyframes WHERE content_id=%s AND filtered_at IS NULL",
                                (cid,)).fetchall()
        by_file = {root.parent / r["path"]: r["id"] for r in rows}
        files = [f for f in by_file if f.exists()]
        missing = [f for f in by_file if f not in files]
        if missing:
            print(f"  #{cid} 有 {len(missing)} 帧的文件不在磁盘上，行不动、只标为已处理", flush=True)
        try:
            sel = select(files, client=None if dry_run else client)
        except Exception as e:  # noqa: BLE001
            stat["failed"] += 1
            print(f"  #{cid} 精简失败，下次再试：{str(e)[:100]}", flush=True)
            continue
        stat["contents"] += 1
        stat["before"] += len(rows)
        stat["after"] += len(sel.keep)
        print(f"  #{cid} {len(rows)} → {len(sel.keep)}", flush=True)
        if dry_run:
            continue
        gone = [f for f in files if f not in dict(sel.keep)]
        with store.pool.connection() as conn:
            for f in gone:
                conn.execute("DELETE FROM keyframes WHERE id=%s", (by_file[f],))
            for f, note in sel.keep:
                conn.execute("UPDATE keyframes SET note=COALESCE(%s, note), filtered_at=now() WHERE id=%s",
                             (note, by_file[f]))
            for f in missing:
                conn.execute("UPDATE keyframes SET filtered_at=now() WHERE id=%s", (by_file[f],))
        stat["files_deleted"] += delete_files(store, gone)
    return stat


def main() -> None:
    ap = argparse.ArgumentParser(description="精简已有关键帧：去空白、合并重复、只留有数据的画面")
    ap.add_argument("--content-id", type=int)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true", help="只做前两步并统计，不调 Gemini、不删")
    a = ap.parse_args()
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        try:
            st = filter_pending(KnowledgeStore(pool), limit=a.limit, content_id=a.content_id, dry_run=a.dry_run)
        except FileNotFoundError as e:
            raise SystemExit(str(e)) from None
        print(f"完成：{st['contents']} 条内容，帧 {st['before']} → {st['after']}，删文件 {st['files_deleted']}，"
              f"失败 {st['failed']}", flush=True)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
