"""Check that every same-origin frontend API prefix is proxied by nginx."""

from __future__ import annotations

import pathlib
import re
import sys


REQUIRED_PREFIXES = {
    "health",
    "chat",
    "price",
    "watchlist",
    "metrics",
    "catalysts",
    "collection",
    "conversations",
    "trading",
    "knowledge",
    "research",
    # 单数：/assets 是 Vite 的静态产物目录，绝不能进 API 代理正则（会白屏）
    "asset",
}


def main() -> int:
    path = pathlib.Path(__file__).with_name("nginx-fanisl.conf")
    config = path.read_text()
    match = re.search(r"location\s+~\s+\^/\(([^)]+)\)\(/\|\$\)", config)
    if match is None:
        print(f"API proxy location not found in {path}", file=sys.stderr)
        return 1
    configured = set(match.group(1).split("|"))
    missing = sorted(REQUIRED_PREFIXES - configured)
    if missing:
        print(f"Missing API proxy prefixes: {', '.join(missing)}", file=sys.stderr)
        return 1
    if "proxy_pass http://127.0.0.1:8000;" not in config:
        print("API proxy target must remain the local uvicorn service on port 8000", file=sys.stderr)
        return 1
    if "assets" in configured:
        print("API proxy must not claim /assets — it is the Vite static output dir", file=sys.stderr)
        return 1
    # 用配置里真正的那条正则跑一遍关键路径：/asset 要走 API，/assets/*.js 必须留给静态。
    proxied = re.compile(rf"^/({match.group(1)})(/|\$)".replace("\\$", "$"))
    for path, want in (("/asset", True), ("/asset/NVDA", True),
                       ("/assets/index-abc.js", False), ("/index.html", False)):
        if bool(proxied.match(path)) is not want:
            print(f"Route regex sends {path} the wrong way (expected proxied={want})", file=sys.stderr)
            return 1
    if not re.search(r"location\s+/\s*\{[^}]*try_files\s+\$uri\s+\$uri/\s+/index\.html;", config, re.DOTALL):
        print("SPA fallback to /index.html not found", file=sys.stderr)
        return 1
    print(f"Validated {len(REQUIRED_PREFIXES)} API proxy prefixes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
