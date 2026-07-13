"""历史回填 CLI：python -m analyzer.knowledge.backfill_creator <youtube_handle> [--limit N]

列频道存档 → 逐视频拉字幕 → 写 L0 contents（幂等去重；无字幕的记 skipped）。带 sleep。
"""

from __future__ import annotations

import sys
import time

from ..config import get_settings
from ..db import make_pool
from .sources.youtube import fetch_transcript, list_videos, set_cookies_file
from .store import KnowledgeStore


def main() -> None:
    handle = sys.argv[1]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    s = get_settings()
    set_cookies_file(s.youtube_cookies_file)
    pool = make_pool(s.pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        creator = next((c for c in store.creators()
                        if any(h["handle"] == handle for h in c["handles"])), None)
        if creator is None:
            raise SystemExit(f"信源未登记：{handle}（先跑 register）")
        vids = list_videos(handle, limit=limit)
        print(f"{handle}: 频道列出 {len(vids)} 个视频", flush=True)
        n_new = n_skip = 0
        n_err = 0
        for i, v in enumerate(vids, 1):
            try:
                tr = fetch_transcript(v["video_id"])
            except Exception as e:  # noqa: BLE001 — bot 验证/限流等单视频失败不中断
                n_err += 1
                print(f"  [{i}] 失败: {str(e)[:80]}", flush=True)
                time.sleep(1.5)
                continue
            if not tr["text"]:
                n_skip += 1
                print(f"  [{i}] 无字幕跳过: {v['title'][:40]}", flush=True)
            else:
                _, created = store.upsert_content(
                    creator["id"], platform="youtube", url=tr["url"] or v["url"],
                    content_type="video", title=tr["title"], published_at=tr["published_at"],
                    raw=tr["text"], lang=tr["lang"])
                n_new += created
                print(f"  [{i}] {'新' if created else '重复'} [{tr['lang']}/{tr['sub_source']}] "
                      f"{(tr['title'] or '')[:40]}  {len(tr['text'])}字 "
                      f"{tr['published_at'].date() if tr['published_at'] else '?'}", flush=True)
            time.sleep(1.5)
        print(f"完成：新入库 {n_new}，无字幕 {n_skip}，失败 {n_err}"
              + ("；失败多=IP 被 bot 验证拦，去用户终端跑或设 YOUTUBE_COOKIES_FILE" if n_err else ""), flush=True)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
