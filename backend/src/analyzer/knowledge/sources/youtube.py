"""YouTube 抓取：yt-dlp 列频道视频 + 拉字幕（zh 优先，含自动字幕）。

- list_videos(handle)：extract_flat 列存档（id/标题/URL），不下载。
- fetch_transcript(video_id)：字幕轨优先级 zh* 人工 > zh* 自动 > en*；
  返回 (纯文本, 语言, published_at, title, 时长秒)。无字幕返回 text=None（记 flag 跳过）。
- 发布时刻：YouTube 只给 upload_date（日粒度）→ 打当日 12:00 UTC 并在 payload 记
  'ts_precision: day'——评分窗按日级容差处理（设计文档已记）。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import yt_dlp

_SUB_PREF = ("zh-Hans", "zh-Hant", "zh", "zh-CN", "zh-TW", "en")


import os


def _ydl(opts: dict) -> yt_dlp.YoutubeDL:
    base = {"quiet": True, "no_warnings": True,
            # 数据中心 IP 常被 watch 页 bot 验证拦；embedded/android 客户端通常放行公开视频
            "extractor_args": {"youtube": {"player_client": ["web_embedded", "android", "web"]}}}
    ck = os.environ.get("YOUTUBE_COOKIES_FILE")   # 用户导出的 cookies.txt（可选）
    if ck:
        base["cookiefile"] = ck
    return yt_dlp.YoutubeDL({**base, **opts})


def list_videos(handle: str, *, limit: int | None = None) -> list[dict]:
    url = f"https://www.youtube.com/{handle}/videos"
    opts = {"extract_flat": True, "playlistend": limit} if limit else {"extract_flat": True}
    with _ydl(opts) as y:
        info = y.extract_info(url, download=False)
    out = []
    for e in info.get("entries") or []:
        if e and e.get("id"):
            out.append({"video_id": e["id"], "title": e.get("title"),
                        "url": f"https://www.youtube.com/watch?v={e['id']}"})
    return out


def _pick_track(subs: dict) -> tuple[str, list] | tuple[None, None]:
    for lang in _SUB_PREF:
        for k, v in subs.items():
            if k == lang or k.startswith(lang + "-") or (lang == "zh" and k.startswith("zh")):
                return k, v
    return (next(iter(subs.items())) if subs else (None, None))


def _vtt_to_text(vtt: str) -> str:
    lines, seen = [], set()
    for ln in vtt.splitlines():
        ln = ln.strip()
        if not ln or "-->" in ln or ln.isdigit() or ln.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        ln = re.sub(r"<[^>]+>", "", ln)
        if ln and ln not in seen:          # 自动字幕滚动窗去重
            seen.add(ln)
            lines.append(ln)
    return "\n".join(lines)


def fetch_transcript(video_id: str) -> dict:
    with _ydl({"writesubtitles": True, "writeautomaticsub": True, "skip_download": True}) as y:
        info = y.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    manual, auto = info.get("subtitles") or {}, info.get("automatic_captions") or {}
    lang, tracks = _pick_track(manual)
    source = "manual"
    if not tracks:
        lang, tracks = _pick_track(auto)
        source = "auto"
    text = None
    if tracks:
        fmt = next((t for t in tracks if t.get("ext") == "vtt"), tracks[0])
        import httpx
        r = httpx.get(fmt["url"], timeout=30)
        if r.status_code == 200:
            text = _vtt_to_text(r.text)
    up = info.get("upload_date")           # YYYYMMDD（日粒度）
    published = (datetime.strptime(up, "%Y%m%d").replace(hour=12, tzinfo=timezone.utc)
                 if up else None)
    return {"text": text, "lang": lang, "sub_source": source if text else None,
            "published_at": published, "title": info.get("title"),
            "duration_s": info.get("duration"), "url": info.get("webpage_url")}
