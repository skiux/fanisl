"""关键帧提取：不下载全片，ffmpeg 对流式直链做 -ss 秒级 seek 只抓单帧。

用法：python -m fanisl.knowledge.keyframes <video_id> <MM:SS> [MM:SS ...] [--height 1080]
输出 jpg 到 data_export/keyframes/<video_id>/。直链由 yt-dlp 解析，每帧只拉目标时刻附近
的几百 KB~几 MB 分片；直链绑发起 IP 且约 6 小时过期，所以一期视频的时间戳在同一次解析
里抓完，直链不入库。

**yt-dlp 必须有 JavaScript 运行时**（JS_RUNTIMES + yt-dlp-ejs 包）。2025-11 起 yt-dlp 解
YouTube 的 JS 挑战要靠外部运行时，默认只认 deno；没有它时 web 系客户端的格式全部缺失，
只剩 android_vr 的 360p 混流，而且直链只让从偏移 0 取到约 1MB——2026-08-14 至 09-28 提帧
失效就是这个样子，当时误判为 YouTube 切 SABR、只能等 yt-dlp 支持。09-28 开启 node 后：
默认客户端给出 1080p 的 https 视频轨，任意时刻 seek 正常（本机与服务器各 3 帧，每帧 4-13s）。

客户端梯队（PLAYER_CLIENTS）：先用 yt-dlp 自己的默认客户端组合，失败再逐个强制指定。
实际用了哪个记进 source，日后墙再动时能看出是哪一级在扛。

两种取法：
- `grab`：按给定时刻 seek 取帧（本 CLI、体检脚本用）。
- `grab_scenes`：整片下载视频轨，只解码关键帧，与上一关键帧画面变化够大才留（摄取链用）。
  **不按视觉笔记的时间戳取**：Gemini 在长视频上的时间戳会漂几分钟，2026-09-28 在 c123 按笔记
  时间戳抽 4 帧，2 帧不是笔记说的那张图。整片取则不依赖它：c123（27 分钟、55MB、下载 13s）
  42 张覆盖了所有展示过的图，TALK君一期 16 张，美投君一期 91 张（剪辑镜头多）。
  只解关键帧（YouTube 约 6 秒一个）是为了服务器的 2 核：逐帧解码整片 1080p 要 197s，只解关键帧 7s。
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Sequence

import yt_dlp

from ..config import get_settings

OUT_DIR = pathlib.Path(__file__).resolve().parents[3] / "data_export" / "keyframes"


def keyframe_root() -> pathlib.Path:
    """帧目录。settings.keyframe_root 优先，空则按 __file__ 推。

    有这个开关是因为 OUT_DIR 依赖源码位置：git worktree 里 data_export（gitignore 的
    数据目录）只存在于主工作区，从 __file__ 推会指向一个不存在的路径。2026-08-14 的
    存量清理差点因此只删库不删文件，API 读图同样会踩。
    """
    configured = (get_settings().keyframe_root or "").strip()
    return pathlib.Path(configured).expanduser().resolve() if configured else OUT_DIR


# None = yt-dlp 的默认客户端组合（2026-09-28 实测给出 1080p https 视频轨）；其余是强制指定的后备
PLAYER_CLIENTS = (None, "android_vr", "tv", "web_safari")
# 解 YouTube JS 挑战的运行时，按 yt-dlp 的优先级取第一个装了的。服务器与本机都有 node
JS_RUNTIMES = {"deno": {}, "node": {}}
DEFAULT_HEIGHT = 1080   # 财经视频的画面主体是表格/图表，读数清晰度优先；单帧 ~230KB
# 与上一关键帧的 ffmpeg scene 分数超过它才留。0.25 只抓到硬切换（c123 仅 4 张）——看盘录屏的
# 图表是平移、缩放、换标的，变化是渐进的。只解关键帧时 0.06 漏图（c123 27 张），0.04 为 42 张、
# 与逐帧每 3 秒取样的 39 张覆盖相同（2026-09-29 对着缩略图逐张核过）
SCENE_THRESHOLD = 0.04


@dataclass(frozen=True)
class Stream:
    url: str
    source: str          # ytdlp:<player_client>
    height: int
    duration_s: int | None
    headers: tuple[tuple[str, str], ...] = ()   # 取流必须带上，见下


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
    fmt = _format(max_height)
    url = f"https://www.youtube.com/watch?v={video_id}"
    errors = []
    for client in PLAYER_CLIENTS:
        label = client or "default"
        opts = _ydl_opts(client, fmt)
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                info = y.extract_info(url, download=False)
        except yt_dlp.utils.YoutubeDLError as e:   # 覆盖 DownloadError/ExtractorError 两支
            errors.append(f"{label}: {str(e)[:80]}")
            continue
        if info.get("url"):
            # **直链是绑 User-Agent 的**：YouTube 按解析时那个 client 的 UA 签发，换个 UA
            # 去取就是 403。ffmpeg 用自己的 UA，所以必须把 yt-dlp 报的请求头透传下去。
            # （2026-08-14 实测：同一条直链 httpx 带 UA 取到 206，ffmpeg 不带就 403。）
            return Stream(info["url"], f"ytdlp:{label}", int(info.get("height") or 0),
                          info.get("duration"),
                          tuple((info.get("http_headers") or {}).items()))
        errors.append(f"{label}: 无可用流")
    raise RuntimeError(f"{video_id} 全客户端解析失败 —— " + " | ".join(errors))


def _format(max_height: int) -> str:
    # 只要 https 直链：m3u8 分片流在 ffmpeg 里 seek 会失败（2026-09-28 实测 fmt 270）
    return (f"bv*[vcodec^=avc1][height<={max_height}][protocol=https]"
            f"/bv*[height<={max_height}][protocol=https]"
            f"/b[height<={max_height}][protocol=https]/b[protocol=https]")


def _ydl_opts(client: str | None, fmt: str) -> dict:
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "format": fmt,
            "js_runtimes": JS_RUNTIMES}
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": [client]}}
    cookies = get_settings().youtube_cookies_file
    if cookies:
        opts["cookiefile"] = cookies
    return opts


def _download(video_id: str, max_height: int, dest_dir: pathlib.Path, *,
              retry_pause_s: float = 30.0) -> tuple[pathlib.Path, dict, str]:
    """整片下载 ≤max_height 的视频轨到 dest_dir。返回 (文件, info, 用的客户端)。

    全客户端都失败时停一会儿整轮再试一次：2026-09-28 服务器连下几期后，一期在所有客户端上都 403，
    几分钟后同一期重下正常——是短时限流，不是这期视频拿不到。
    """
    try:
        return _download_once(video_id, max_height, dest_dir)
    except RuntimeError as e:
        if is_bot_check(e):          # 要求登录验证不是几十秒能过去的，重试只会延长它
            raise
        time.sleep(retry_pause_s)
        return _download_once(video_id, max_height, dest_dir)


def is_bot_check(err: Exception) -> bool:
    """YouTube 要求登录验证（"Sign in to confirm you're not a bot"）：这台机器的 IP 被标记了。"""
    return "confirm you" in str(err) and "not a bot" in str(err)


def _download_once(video_id: str, max_height: int, dest_dir: pathlib.Path) -> tuple[pathlib.Path, dict, str]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    errors = []
    for client in PLAYER_CLIENTS:
        label = client or "default"
        opts = {**_ydl_opts(client, _format(max_height)),
                "outtmpl": {"default": str(dest_dir / f"{label}.%(ext)s")}}
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                info = y.extract_info(url, download=True)
        except yt_dlp.utils.YoutubeDLError as e:
            errors.append(f"{label}: {str(e)[:80]}")
            continue
        got = sorted(dest_dir.glob(f"{label}.*"))
        if got:
            return got[0], info, label
        errors.append(f"{label}: 下载后找不到文件")
    raise RuntimeError(f"{video_id} 全客户端下载失败 —— " + " | ".join(errors))


def grab_scenes(video_id: str, *, max_height: int = DEFAULT_HEIGHT,
                threshold: float = SCENE_THRESHOLD,
                skip: frozenset[int] | set[int] = frozenset(),
                out_root: pathlib.Path = OUT_DIR) -> list[Frame]:
    """整片下载后按画面变化取帧：只看关键帧，与上一关键帧差异够大才留，首帧必留。

    `skip` 是已经有帧的秒数（按笔记时间戳取过的旧帧），同一秒不重复落盘。视频文件抽完即删。
    """
    out_dir = out_root / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fanisl-kf-") as tmp:
        tmp = pathlib.Path(tmp)
        src, info, label = _download(video_id, max_height, tmp)
        height = int(info.get("height") or 0)
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "info", "-skip_frame", "nokey",
             "-i", str(src), "-vf", f"select='gt(scene,{threshold})+eq(n,0)',showinfo",
             "-fps_mode", "vfr", "-q:v", "3", str(tmp / "f%05d.jpg")],
            capture_output=True, text=True, timeout=1800, check=True)
        # showinfo 在 select 之后，一行对应一张输出帧；pts_time 是视频内秒数
        secs = [round(float(x)) for x in re.findall(r"pts_time:\s*([\d.]+)", proc.stderr)]
        files = sorted(tmp.glob("f*.jpg"))
        if len(files) != len(secs):
            raise RuntimeError(f"{video_id} 抽出 {len(files)} 张、时刻 {len(secs)} 个，对不上")
        frames, used = [], set(skip)
        for f, sec in zip(files, secs):
            if sec in used:              # 已有旧帧，或两个关键帧落在同一秒
                continue
            used.add(sec)
            dest = out_dir / f"{sec:05d}s_h{height}.jpg"
            shutil.move(str(f), dest)
            frames.append(Frame(sec, dest, dest.stat().st_size, height, f"ytdlp:{label}:scene"))
    return frames


def _ffmpeg_header_args(stream: Stream) -> list[str]:
    """把 yt-dlp 的请求头翻译成 ffmpeg 参数。

    User-Agent 走 -user_agent（ffmpeg 的 http 协议单列了这个选项，塞进 -headers 会被
    它自己的默认 UA 覆盖掉）；其余头拼成 CRLF 分隔的 -headers。
    """
    hdrs = dict(stream.headers)
    args: list[str] = []
    ua = hdrs.pop("User-Agent", None)
    if ua:
        args += ["-user_agent", ua]
    rest = "".join(f"{k}: {v}\r\n" for k, v in hdrs.items()
                   if k.lower() not in ("accept-encoding", "range"))
    if rest:
        args += ["-headers", rest]
    return args


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
                ["ffmpeg", "-y", "-loglevel", "error", *_ffmpeg_header_args(stream),
                 "-ss", str(sec), "-i", stream.url, "-frames:v", "1", "-q:v", "2", str(out)],
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
