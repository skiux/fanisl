"""K2 主通道 CLI：Gemini URL 直读视频 → 转录+视觉笔记 → 写 L0。

用法：python -m analyzer.knowledge.transcribe_video <youtube_handle> <video_id>
元数据（标题/发布日期/时长）走 yt-dlp（web_embedded 足够），正文走 Gemini。幂等。
"""

from __future__ import annotations

import sys

from ..config import get_settings
from ..db import make_pool
from .llm import GeminiClient, render_l0_text
from .sources.youtube import fetch_transcript, set_cookies_file
from .store import KnowledgeStore


def main() -> None:
    handle, video_id = sys.argv[1], sys.argv[2]
    s = get_settings()
    if not s.gemini_api_key:
        raise SystemExit("缺 GEMINI_API_KEY")
    set_cookies_file(s.youtube_cookies_file)
    url = f"https://www.youtube.com/watch?v={video_id}"

    meta = fetch_transcript(video_id)   # 复用：元数据 + 有字幕则白捡
    print(f"元数据: {meta['title']}  {meta['published_at']}  {meta['duration_s']}s", flush=True)

    tr = GeminiClient(s.gemini_api_key).transcribe_youtube(url)
    raw = render_l0_text(tr)
    n_notes = len(tr.get("visual_notes", []))
    print(f"Gemini: 转录 {len(tr.get('transcript', ''))} 字，视觉笔记 {n_notes} 条", flush=True)

    pool = make_pool(s.pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        creator = next((c for c in store.creators()
                        if any(h["handle"] == handle for h in c["handles"])), None)
        if creator is None:
            raise SystemExit(f"信源未登记：{handle}")
        cid, created = store.upsert_content(
            creator["id"], platform="youtube", url=url, content_type="video",
            title=meta["title"], published_at=meta["published_at"],
            raw=raw, lang=tr.get("lang"))
        print(f"L0 content#{cid} {'新建' if created else '已存在(同文去重)'}", flush=True)
        # 视觉笔记时间戳顺手打印（供 keyframes 提帧验证）
        for n in tr.get("visual_notes", [])[:8]:
            print(f"  [{n['t']}] {n['kind']}: {n['note'][:60]}", flush=True)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
