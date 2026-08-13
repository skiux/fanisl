"""关键帧提取：不下载全片，ffmpeg 对流式直链做 -ss 秒级 seek 只抓单帧。

用法：python -m analyzer.knowledge.keyframes <video_id> <MM:SS> [MM:SS ...] [--height 1080]
输出 jpg 到 data_export/keyframes/<video_id>/。直链由 yt-dlp 解析，每帧只拉目标时刻附近
的几百 KB~几 MB 分片；直链绑发起 IP 且约 6 小时过期，所以一期视频的时间戳在同一次解析
里抓完，直链不入库。

客户端梯队（PLAYER_CLIENTS）：YouTube 的 bot 墙是按 player client 收紧的——2026-07-16
实测全客户端被 PO Token 拦死（当时判"提帧不可用"），2026-08-14 复测 android_vr 已放行。
逐个试到解析出流为止，实际用了哪个记进 source，日后墙再动时能看出是哪一级在扛。全线失败
时的后续手段（依次）：PO Token provider 插件（bgutil，本机 node/deno 可跑）→ Playwright
渲染层截帧 → storyboard 缩略图（320×180，只够存证不够读数）。
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Sequence

import yt_dlp

from ..config import get_settings

OUT_DIR = pathlib.Path(__file__).resolve().parents[4] / "data_export" / "keyframes"
PLAYER_CLIENTS = ("android_vr", "tv", "ios", "web_safari", "web")
DEFAULT_HEIGHT = 1080   # 财经视频的画面主体是表格/图表，读数清晰度优先；单帧 ~230KB


@dataclass(frozen=True)
class Stream:
    url: str
    source: str          # ytdlp:<player_client>
    height: int
    duration_s: int | None


@dataclass(frozen=True)
class Frame:
    ts_s: int
    path: pathlib.Path
    bytes: int
    height: int
    source: str


def stream_url(video_id: str, *, max_height: int = DEFAULT_HEIGHT) -> Stream:
    """解析 ≤max_height 的视频轨直链（不下载）。

    优先 avc1 的 DASH 视频轨：关键帧密、seek 快，且不像混流 mp4 那样被锁在 360p
    （YouTube 唯一的混流 mp4 是 640×360 的 fmt 18——旧实现用 best[ext=mp4] 选它，
    --height 给多少都出 360p）。
    """
    s = get_settings()
    fmt = (f"bv*[vcodec^=avc1][height<={max_height}]/bv*[height<={max_height}]"
           f"/b[height<={max_height}]/b")
    url = f"https://www.youtube.com/watch?v={video_id}"
    errors = []
    for client in PLAYER_CLIENTS:
        opts = {"quiet": True, "no_warnings": True, "format": fmt,
                "extractor_args": {"youtube": {"player_client": [client]}}}
        if s.youtube_cookies_file:
            opts["cookiefile"] = s.youtube_cookies_file
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                info = y.extract_info(url, download=False)
        except yt_dlp.utils.YoutubeDLError as e:   # 覆盖 DownloadError/ExtractorError 两支
            errors.append(f"{client}: {str(e)[:80]}")
            continue
        if info.get("url"):
            return Stream(info["url"], f"ytdlp:{client}", int(info.get("height") or 0),
                          info.get("duration"))
        errors.append(f"{client}: 无可用流")
    raise RuntimeError(f"{video_id} 全客户端解析失败 —— " + " | ".join(errors))


def _to_seconds(ts: str | int) -> int:
    if isinstance(ts, int):
        return ts
    parts = [int(x) for x in ts.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def _grab_one(stream: Stream, sec: int, out_dir: pathlib.Path, *, retries: int = 2) -> Frame | None:
    out = out_dir / f"{sec:05d}s_h{stream.height}.jpg"
    if out.exists() and out.stat().st_size > 0:      # 幂等：已抓过不重抓
        return Frame(sec, out, out.stat().st_size, stream.height, stream.source)
    for attempt in range(retries + 1):
        try:
            # -ss 在 -i 之前 = 输入级 seek：只请求目标时刻附近的分片
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec),
                 "-i", stream.url, "-frames:v", "1", "-q:v", "2", str(out)],
                check=True, capture_output=True, timeout=180,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            out.unlink(missing_ok=True)
            if attempt < retries:      # googlevideo 分片偶发 TLS/EOF，重试基本就过
                time.sleep(2.0 * (attempt + 1))
                continue
            detail = (getattr(e, "stderr", b"") or b"").decode(errors="replace")
            print(f"    {sec}s 抓帧失败：{detail.strip()[:100] or e}", flush=True)
            return None
        if out.exists() and out.stat().st_size > 0:
            return Frame(sec, out, out.stat().st_size, stream.height, stream.source)
        out.unlink(missing_ok=True)
    return None


def grab(video_id: str, timestamps: Sequence[str | int], *,
         max_height: int = DEFAULT_HEIGHT, workers: int = 4,
         out_root: pathlib.Path = OUT_DIR) -> list[Frame]:
    """一次解析直链，抓多帧（并发受限于 workers；单帧失败不影响其余）。"""
    stream = stream_url(video_id, max_height=max_height)
    secs = sorted({_to_seconds(t) for t in timestamps})
    if stream.duration_s:   # 越界时间戳（转录偶有虚构）先滤掉，省一轮必失败的 ffmpeg
        over = [s for s in secs if s >= stream.duration_s]
        if over:
            print(f"    跳过 {len(over)} 个超出时长({stream.duration_s}s)的时间戳", flush=True)
        secs = [s for s in secs if s < stream.duration_s]
    out_dir = out_root / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        frames = list(ex.map(lambda s: _grab_one(stream, s, out_dir), secs))
    return [f for f in frames if f is not None]


def main() -> None:
    ap = argparse.ArgumentParser(description="按时间戳抓 YouTube 视频关键帧")
    ap.add_argument("video_id")
    ap.add_argument("timestamps", nargs="+", help="MM:SS / HH:MM:SS / 秒")
    ap.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    for f in grab(a.video_id, a.timestamps, max_height=a.height, workers=a.workers):
        print(f"{f.path}  {f.bytes // 1024}KB  h{f.height}  {f.source}")


if __name__ == "__main__":
    main()
