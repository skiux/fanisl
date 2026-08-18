"""外部数据源体检：逐个访问、报成败与关键读数。部署后与怀疑"取不到数"时跑。

用法：cd backend && PYTHONPATH=src .venv/bin/python tools/check_sources.py
      加 --llm 会真调一次 Gemini（消耗额度），不加只验通道选择与取 token。
"""

import argparse
import datetime as dt
import sys
import time

_ROW = "  {:<4} {:<22} {:>6.1f}s  {}"


def _run(name, fn, results):
    t0 = time.time()
    try:
        detail = fn()
        ok = True
    except Exception as e:
        detail = f"{type(e).__name__}: {str(e).splitlines()[0][:100]}"
        ok = False
    results.append(ok)
    print(_ROW.format("ok" if ok else "FAIL", name, time.time() - t0, detail), flush=True)


def check_yfinance():
    from analyzer.knowledge.prices import fetch_yf
    rows = fetch_yf("SPX", dt.date.today() - dt.timedelta(days=10))
    if not rows:
        raise RuntimeError("返回空（可能全被未收盘闸门丢掉，换个时段再试）")
    return f"SPX 最近 {len(rows)} 根，末根 {rows[-1][0]} 收 {rows[-1][4]:.2f}"


def check_fred():
    from analyzer.knowledge.prices import fetch_fred
    rows = fetch_fred("DFEDTARU", dt.date.today() - dt.timedelta(days=30))
    return f"DFEDTARU {len(rows)} 条，末值 {rows[-1][4]}"


def check_eps():
    from analyzer.knowledge.estimates import fetch_eps_trend
    d = fetch_eps_trend("GOOGL")
    return f"GOOGL +1y 前瞻 EPS {d['current']:.3f}（30 天前 {d['d30']:.3f}）"


def check_youtube_list():
    from analyzer.knowledge.sources import youtube
    v = youtube.list_videos("@andyleegogo", limit=3)
    return f"清单 {len(v)} 条，最新《{v[0]['title'][:24]}》"


def check_youtube_meta():
    from analyzer.knowledge.sources import youtube
    m = youtube.fetch_transcript("6nGA97LlfSA")
    return f"元数据 {m['published_at']:%Y-%m-%d} {m['duration_s']}s 字幕轨{'有' if m.get('transcript') else '无'}"


def check_llm_channel():
    from analyzer.config import get_settings
    from analyzer.knowledge.llm import make_client
    c = make_client(get_settings())
    kind = type(c).__name__
    if kind == "VertexGeminiClient":
        tok = c._access_token()
        return f"{kind} project={c.project} model={c.model} token 已取（{len(tok)} 字符）"
    return f"{kind} model={c.model}（AI Studio key）"


def check_llm_call():
    from analyzer.config import get_settings
    from analyzer.knowledge.llm import make_client
    c = make_client(get_settings())
    d = c.generate_json([{"text": "只回 JSON：{\"ok\": true}"}],
                        {"type": "object", "properties": {"ok": {"type": "boolean"}},
                         "required": ["ok"]})
    return f"generateContent 通，返回 {d}"


def check_binance():
    import httpx
    r = httpx.get("https://api.binance.com/api/v3/ping", timeout=15.0)
    r.raise_for_status()
    return "api.binance.com 可达（此前本机长期 451 地域封锁）"


def check_keyframes():
    """必须真抓一帧才算通。

    只调 stream_url 会给假阳性：SABR 之下直链**解析得到**，但按任意时刻取范围时
    才 403。2026-08-19 实测就栽在这里——解析成功让人以为墙下去了，实际 529 帧一张没抓到。
    """
    import tempfile, pathlib as _p
    from analyzer.knowledge.keyframes import grab
    with tempfile.TemporaryDirectory() as d:
        frames = grab("6nGA97LlfSA", ["01:00"], max_height=720, out_root=_p.Path(d))
        if not frames:
            raise RuntimeError("直链解析到了，但取不到任意时刻的帧（SABR）")
        return f"抓到 {len(frames)} 帧，{frames[0].bytes} 字节 via {frames[0].source}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true", help="真调一次 Gemini，消耗额度")
    args = ap.parse_args()

    print("知识引擎（主线）")
    r1 = []
    _run("yfinance 日线", check_yfinance, r1)
    _run("FRED 政策利率", check_fred, r1)
    _run("yfinance 盈利预期", check_eps, r1)
    _run("YouTube 频道清单", check_youtube_list, r1)
    _run("YouTube 元数据", check_youtube_meta, r1)
    _run("Gemini 通道", check_llm_channel, r1)
    if args.llm:
        _run("Gemini 实调", check_llm_call, r1)

    print("\n已知会失败的（失败属预期，不计入结论）")
    _run("提帧取直链", check_keyframes, [])

    print("\n交易/研究侧（与知识引擎无关）")
    _run("Binance", check_binance, [])

    bad = r1.count(False)
    print(f"\n主线 {len(r1) - bad}/{len(r1)} 通过" + ("" if not bad else f"，{bad} 项需处理"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
