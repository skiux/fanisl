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
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Sequence

import httpx
import yt_dlp

from ..config import get_settings

OUT_DIR = pathlib.Path(__file__).resolve().parents[4] / "data_export" / "keyframes"


def keyframe_root() -> pathlib.Path:
    """帧目录。settings.keyframe_root 优先，空则按 __file__ 推。

    有这个开关是因为 OUT_DIR 依赖源码位置：git worktree 里 data_export（gitignore 的
    数据目录）只存在于主工作区，从 __file__ 推会指向一个不存在的路径。2026-08-14 的
    存量清理差点因此只删库不删文件，API 读图同样会踩。
    """
    configured = (get_settings().keyframe_root or "").strip()
    return pathlib.Path(configured).expanduser().resolve() if configured else OUT_DIR
PLAYER_CLIENTS = ("android_vr", "tv", "ios", "web_safari", "web")
DEFAULT_HEIGHT = 1080   # 财经视频的画面主体是表格/图表，读数清晰度优先；单帧 ~230KB


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
            # **直链是绑 User-Agent 的**：YouTube 按解析时那个 client 的 UA 签发，换个 UA
            # 去取就是 403。ffmpeg 用自己的 UA，所以必须把 yt-dlp 报的请求头透传下去。
            # （2026-08-14 实测：同一条直链 httpx 带 UA 取到 206，ffmpeg 不带就 403。）
            return Stream(info["url"], f"ytdlp:{client}", int(info.get("height") or 0),
                          info.get("duration"),
                          tuple((info.get("http_headers") or {}).items()))
        errors.append(f"{client}: 无可用流")
    raise RuntimeError(f"{video_id} 全客户端解析失败 —— " + " | ".join(errors))


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


# 2026-08-14：提帧整体失效。逐层排除后的结论——**这条路被 YouTube 关掉了，不是本地问题**：
#   · 不带 Range 取直链 → 403；Range: bytes=0-2MB → 206；bytes=2MB-4MB / 10-11MB → 403
#     即只有从偏移 0 开始的区间被服务（当天稍晚连偏移 0 也开始 403 了，还在收紧）
#   · 换 &range= 查询参数、加 rn/rbuf、换 6 个 itag、换 5 个 player client：同样
#   · 出口 IP 稳定且与直链里的 ip= 一致（不是代理漂移）
#   · cookies 有效（解析和头 2MB 当时能过）；yt-dlp 已是最新发行版 2026.07.04
#   · **PO Token provider（bgutil 1.3.1 + deno）已装好并确实在签发 token**，但没用：
#     token 服务的是 web/web_safari 客户端，而这些客户端现在只给 SABR 流、根本不暴露
#     普通直链；唯一还给直链的 android_vr 又不吃 token（直链里 c=ANDROID_VR）。
#   · 注意直链里**没有 n= 参数**，所以这不是经典的 n 签名节流，是 SABR 迁移。
#
# 也就是说要恢复提帧，得等 yt-dlp 的 SABR/UMP 支持落地（或改走渲染层截图那条路）。
# 在那之前提帧对新视频不可用；L0/L1/L2 全链不受影响（grab_for_content 是 best-effort），
# 存量帧也不受影响。下面这套有界分块下载在 SABR 支持落地后仍然有用——比"每帧一次网络
# seek"快，每期只下一次——所以留着。
_RANGE_CHUNK = 2 << 20


def download_stream(stream: Stream, dest: pathlib.Path, *, on_progress=None) -> int:
    """按有界 Range 分块把直链拉到本地。返回字节数。"""
    headers = dict(stream.headers)
    with httpx.Client(timeout=60.0, follow_redirects=True) as cl:
        probe = cl.get(stream.url, headers={**headers, "Range": "bytes=0-1"})
        probe.raise_for_status()
        total = int(probe.headers.get("content-range", "bytes 0-1/0").rsplit("/", 1)[-1])
        got = 0
        with dest.open("wb") as fh:
            while got < total:
                end = min(got + _RANGE_CHUNK - 1, total - 1)
                r = cl.get(stream.url, headers={**headers, "Range": f"bytes={got}-{end}"})
                if r.status_code not in (200, 206) or not r.content:
                    raise RuntimeError(
                        f"取流在偏移 {got} 处 HTTP {r.status_code}：YouTube 已切 SABR，"
                        f"普通直链只服务从 0 开始的区间，取不到任意时刻的画面。"
                        f"PO Token 也解决不了（原因见 keyframes.py 顶注），"
                        f"要等 yt-dlp 的 SABR 支持")
                fh.write(r.content)
                got += len(r.content)
                if on_progress:
                    on_progress(got, total)
    return got


def _grab_one(stream: Stream, sec: int, out_dir: pathlib.Path, *,
              local: pathlib.Path | None, retries: int = 2) -> Frame | None:
    out = out_dir / f"{sec:05d}s_h{stream.height}.jpg"
    if out.exists() and out.stat().st_size > 0:      # 幂等：已抓过不重抓
        return Frame(sec, out, out.stat().st_size, stream.height, stream.source)
    if local is None:
        return None
    for attempt in range(retries + 1):
        try:
            # -ss 在 -i 之前 = 输入级 seek。输入是本地文件，seek 不走网络
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec),
                 "-i", str(local), "-frames:v", "1", "-q:v", "2", str(out)],
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
    todo = [s for s in secs
            if not (out_dir / f"{s:05d}s_h{stream.height}.jpg").exists()]
    if not todo:
        return [f for f in (_grab_one(stream, s, out_dir, local=None) for s in secs)
                if f is not None]

    # 整条流先落到本地临时文件（见 download_stream 顶注：直链只认有界 Range，
    # ffmpeg 直接 seek 必 403）。抽完即删，不占长期磁盘。
    with tempfile.TemporaryDirectory(prefix="fanisl-kf-") as tmp:
        local = pathlib.Path(tmp) / f"{video_id}.bin"
        t0 = time.time()
        size = download_stream(stream, local)
        print(f"    取流 {size / 1048576:.0f} MB / {time.time() - t0:.0f}s "
              f"（{stream.source} {stream.height}p，{len(todo)} 帧待抽）", flush=True)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            frames = list(ex.map(lambda s: _grab_one(stream, s, out_dir, local=local), secs))
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
