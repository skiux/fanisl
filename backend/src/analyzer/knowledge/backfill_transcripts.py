"""批量转录回填：频道近 N 天视频 → Gemini URL 直读 → L0（幂等、限速、失败不中断）。

用法：python -m analyzer.knowledge.backfill_transcripts <handle>
      [--since-days 60] [--limit N] [--max-new N] [--models a,b,c]
- 频道 /videos 按新→旧列出；URL 已入库的跳过（不重复付 Gemini）；发布早于窗口即停止。
- --limit 限制列多少个视频，--max-new 限制这一轮实际转录多少条新内容。
- --models 是模型阶梯：免费额度按模型独立计，主模型当天用尽就换下一个继续，全部用尽才停。
  **阶梯里不要放 lite 档**：2026-08-13 实测 gemini-3.5-flash-lite 转录会丢数字
  （投资TALK君 c41 把 SOX 的 19.94 倍转成 "9.94倍，那接近有20倍了"，自相矛盾）。
  对数字密集的财报/估值类内容，L0 的数字就是内容本身，quote 又是评分争议的仲裁依据，
  丢一位数会一路污染到 ScoringSpec。宁可等次日额度重置，也只用 flash 档及以上。
- Gemini 429/5xx 退避重试（视频转录是慢活，本脚本设计为后台慢跑）。
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

from ..config import get_settings
from ..db import make_pool
from .backfill_keyframes import grab_for_content
from .llm import TruncatedGeneration, make_client, render_l0_text
from .sources.youtube import fetch_transcript, list_videos, set_cookies_file
from .store import KnowledgeStore

SLEEP_BETWEEN_S = 20.0    # 视频间隔（礼貌 + 平滑限额）
RETRIES = 3
BACKOFF_S = 60.0          # 瞬时限流/5xx 的兜底退避（服务端给了 retryDelay 时优先用它）


class DailyQuotaExhausted(RuntimeError):
    """当天该模型的免费额度用尽——重试无意义，整轮停止。"""


def _quota_detail(e: httpx.HTTPStatusError) -> tuple[bool, float | None]:
    """解析 429 响应 → (是否每日配额耗尽, 服务端建议的重试秒数)。"""
    try:
        err = e.response.json().get("error", {})
    except ValueError:
        return False, None
    per_day, delay = False, None
    for d in err.get("details", []):
        for v in d.get("violations", []):
            if "PerDay" in (v.get("quotaId") or ""):
                per_day = True
        raw = d.get("retryDelay")
        if isinstance(raw, str) and raw.endswith("s"):
            try:
                delay = float(raw[:-1])
            except ValueError:
                pass
    return per_day, delay


def _transcribe_with_retry(client, url: str) -> dict | None:
    for attempt in range(RETRIES + 1):
        try:
            return client.transcribe_youtube(url)
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code == 429:
                per_day, delay = _quota_detail(e)
                if per_day:
                    # 每日配额是按天重置的，退避多久都没用——早停比空转 30 分钟诚实
                    raise DailyQuotaExhausted(
                        f"模型 {client.model} 当天免费额度已用尽，明日重置或换模型/升配额") from e
                wait = delay + 5.0 if delay else BACKOFF_S * (attempt + 1)
                if attempt < RETRIES:
                    print(f"    Gemini 429（瞬时限流），等 {wait:.0f}s 重试", flush=True)
                    time.sleep(wait)
                    continue
            elif code in (500, 503) and attempt < RETRIES:
                print(f"    Gemini {code}，退避 {BACKOFF_S * (attempt + 1):.0f}s"
                      f"（第 {attempt + 1} 次）", flush=True)
                time.sleep(BACKOFF_S * (attempt + 1))
                continue
            print(f"    Gemini 失败：HTTP {code}", flush=True)
            return None
        except (httpx.HTTPError, KeyError, ValueError, TruncatedGeneration) as e:
            if attempt < RETRIES:
                time.sleep(30.0)
                continue
            print(f"    Gemini 失败：{str(e)[:80]}", flush=True)
            return None
    return None


def run(handle: str, *, since_days: int = 60, limit: int | None = None,
        max_new: int | None = None, models: list[str] | None = None) -> None:
    s = get_settings()
    set_cookies_file(s.youtube_cookies_file)
    cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
    # 免费额度是按模型计的：主模型当天用尽就顺着阶梯换下一个，而不是整轮停掉
    ladder = list(models or [s.gemini_model])
    client = make_client(s, model=ladder[0])
    pool = make_pool(s.pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        creator = next((c for c in store.creators()
                        if any(h["handle"] == handle for h in c["handles"])), None)
        if creator is None:
            raise SystemExit(f"信源未登记：{handle}")
        vids = list_videos(handle, limit=limit)
        print(f"{handle}: 频道列出 {len(vids)} 个视频，窗口 {since_days} 天（≥{cutoff.date()}）", flush=True)
        n_new = n_skip = n_fail = 0
        for i, v in enumerate(vids, 1):
            url = f"https://www.youtube.com/watch?v={v['video_id']}"
            if store.content_url_exists(url):
                n_skip += 1
                continue
            try:
                meta = fetch_transcript(v["video_id"])   # 元数据（+字幕白捡，当前两频道无）
            except Exception as e:  # noqa: BLE001 — 单视频元数据失败跳过
                n_fail += 1
                print(f"  [{i}] 元数据失败: {str(e)[:60]}", flush=True)
                continue
            pub = meta["published_at"]
            if pub is not None and pub < cutoff:
                print(f"  [{i}] {pub.date()} 早于窗口，停止（频道按新→旧）", flush=True)
                break
            while True:
                try:
                    tr = _transcribe_with_retry(client, url)
                    break
                except DailyQuotaExhausted as e:
                    ladder.pop(0)
                    if not ladder:
                        print(f"  [{i}] {e}；阶梯上的模型都已用尽，本轮停止"
                              f"（已入库 {n_new} 条不受影响）", flush=True)
                        tr = None
                        break
                    print(f"  [{i}] {e}；换用 {ladder[0]} 继续", flush=True)
                    client = make_client(s, model=ladder[0])
            if tr is None and not ladder:
                break
            if tr is None or not tr.get("transcript"):
                n_fail += 1
                time.sleep(SLEEP_BETWEEN_S)
                continue
            u = client.last_usage or {}
            raw = render_l0_text(tr)
            cid, created = store.upsert_content(
                creator["id"], platform="youtube", url=url, content_type="video",
                title=meta["title"], published_at=pub, raw=raw,
                lang=tr.get("lang"),
                triage={"model": client.model, "channel": type(client).__name__,
                        "tokens": u.get("totalTokenCount")})
            n_new += created
            # 摄取时顺手提帧：视频被删后画面就只剩文字记录了（失败不影响 L0）
            n_frames = 0
            try:
                n_frames = grab_for_content(store, {"id": cid, "url": url, "raw": raw})
            except Exception as e:  # noqa: BLE001
                print(f"    提帧失败（可用 backfill_keyframes 补）：{str(e)[:80]}", flush=True)
            print(f"  [{i}] {'新' if created else '重复'} {(meta['title'] or '')[:36]}  "
                  f"{len(tr['transcript'])}字/{len(tr.get('visual_notes', []))}笔记/{n_frames}帧  "
                  f"tok={u.get('totalTokenCount', '?')}  {pub.date() if pub else '?'}", flush=True)
            if max_new is not None and n_new >= max_new:
                print(f"  已达 --max-new {max_new}，停止", flush=True)
                break
            time.sleep(SLEEP_BETWEEN_S)
        print(f"完成 {handle}：新 {n_new}，跳过 {n_skip}，失败 {n_fail}", flush=True)
    finally:
        pool.close()


def main() -> None:
    handle = sys.argv[1]
    def _arg(flag, cast=int, default=None):
        return cast(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default
    run(handle, since_days=_arg("--since-days", default=60), limit=_arg("--limit"),
        max_new=_arg("--max-new"),
        models=_arg("--models", lambda v: [m.strip() for m in v.split(",")]))


if __name__ == "__main__":
    main()
