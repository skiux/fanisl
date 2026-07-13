"""关键帧提取：不下载全片，ffmpeg 对流式 URL 做 -ss 秒级 seek 只抓单帧。

用法：python -m analyzer.knowledge.keyframes <video_id> <MM:SS> [MM:SS ...] [--height 720]
输出 jpg 到 data_export/keyframes/<video_id>/。流 URL 由 yt-dlp 解析（带 cookies），
每帧只拉取目标时刻附近的几百 KB~几 MB 分片。
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

import yt_dlp

from ..config import get_settings
from .sources.youtube import set_cookies_file

OUT_DIR = pathlib.Path(__file__).resolve().parents[4] / "data_export" / "keyframes"


def stream_url(video_id: str, *, max_height: int = 720) -> str:
    """取 ≤max_height 的 mp4 视频流直链（mp4 关键帧密、seek 快；不下载）。"""
    s = get_settings()
    opts = {"quiet": True, "no_warnings": True,
            # 与 sources.youtube 同款客户端回退（数据中心 IP 过 bot 验证的关键）
            "extractor_args": {"youtube": {"player_client": ["android", "web_embedded", "web"]}},
            "format": f"best[ext=mp4][height<={max_height}]/best[height<={max_height}]/best"}
    if s.youtube_cookies_file:
        opts["cookiefile"] = s.youtube_cookies_file
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return info["url"]


def _to_seconds(ts: str) -> int:
    parts = [int(x) for x in ts.split(":")]
    return parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0] * 3600 + parts[1] * 60 + parts[2]


def grab(video_id: str, timestamps: list[str], *, max_height: int = 720) -> list[pathlib.Path]:
    url = stream_url(video_id, max_height=max_height)
    out_dir = OUT_DIR / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    outs = []
    for ts in timestamps:
        out = out_dir / f"{ts.replace(':', 'm')}s_h{max_height}.jpg"
        # -ss 在 -i 之前 = 输入级 seek：只请求目标时刻附近的分片
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(_to_seconds(ts)),
             "-i", url, "-frames:v", "1", "-q:v", "2", str(out)],
            check=True, timeout=120,
        )
        outs.append(out)
    return outs


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    height = int(sys.argv[sys.argv.index("--height") + 1]) if "--height" in sys.argv else 720
    video_id, stamps = args[0], args[1:]
    set_cookies_file(get_settings().youtube_cookies_file)
    for p in grab(video_id, stamps, max_height=height):
        print(p)


if __name__ == "__main__":
    main()
