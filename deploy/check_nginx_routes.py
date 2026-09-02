"""检查 nginx 是否把所有同源 API 前缀都代理到了后端。

    python3 deploy/check_nginx_routes.py                      # 查仓库里那份
    sudo python3 deploy/check_nginx_routes.py /etc/nginx/sites-enabled/fanisl   # 查**生效**那份

**默认只查仓库版本是不够的。** certbot 改过之后两份配置就分叉了，而分叉的方向通常是
生效版本落后——2026-09-02 发现线上少了 asset/auth/admin/portfolio/orders/ledger 六个
前缀，标的工作台从部署当天起就在线上返回 index.html 而不是 JSON。GET 拿到一份 HTML
不会像 POST 拿到 405 那样报错，所以一直没人发现，而这个脚本一直在报"全部通过"。

部署后请在服务器上带路径跑一次。
"""

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
    # 登录与用户管理（2026-09-02）
    "auth",
    "admin",
    # 资产台三组接口
    "portfolio",
    "orders",
    "ledger",
}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    path = (pathlib.Path(argv[0]) if argv
            else pathlib.Path(__file__).with_name("nginx-fanisl.conf"))
    if not path.is_file():
        print(f"配置文件不存在: {path}", file=sys.stderr)
        return 1
    config = path.read_text()
    match = re.search(r"location\s+~\s+\^/\(([^)]+)\)\(/\|\$\)", config)
    if match is None:
        print(f"API proxy location not found in {path}", file=sys.stderr)
        return 1
    configured = set(match.group(1).split("|"))
    missing = sorted(REQUIRED_PREFIXES - configured)
    if missing:
        print(f"{path} 缺少这些 API 前缀: {', '.join(missing)}\n"
              f"缺了它们，对应请求会落到 SPA 的静态兜底：\n"
              f"  GET  → 返回 index.html（前端拿 HTML 去 JSON.parse）\n"
              f"  POST → nginx 回 405 Not Allowed", file=sys.stderr)
        return 1
    if "proxy_pass http://127.0.0.1:8000;" not in config:
        print("API proxy target must remain the local uvicorn service on port 8000", file=sys.stderr)
        return 1
    if "assets" in configured:
        print("API proxy must not claim /assets — it is the Vite static output dir", file=sys.stderr)
        return 1
    # 用配置里真正的那条正则跑一遍关键路径：/asset 要走 API，/assets/*.js 必须留给静态。
    proxied = re.compile(rf"^/({match.group(1)})(/|\$)".replace("\\$", "$"))
    for probe, want in (("/asset", True), ("/asset/NVDA", True),
                        ("/auth/login", True), ("/portfolio", True),
                        ("/assets/index-abc.js", False), ("/index.html", False)):
        if bool(proxied.match(probe)) is not want:
            print(f"路径正则把 {probe} 送错了方向（期望 proxied={want}）", file=sys.stderr)
            return 1
    if not re.search(r"location\s+/\s*\{[^}]*try_files\s+\$uri\s+\$uri/\s+/index\.html;", config, re.DOTALL):
        print("SPA fallback to /index.html not found", file=sys.stderr)
        return 1
    # 不带斜杠的 /console 必须重定向，否则落到 SPA 兜底、进的是**知识引擎**
    if not re.search(r"location\s+=\s+/console\s*\{[^}]*return\s+301\s+/console/;", config, re.DOTALL):
        print("缺少 `location = /console { return 301 /console/; }`：\n"
              "  不带斜杠的 /console 会落到 SPA 兜底、返回知识引擎的 index.html，"
              "用户输这个地址进去的是另一个应用", file=sys.stderr)
        return 1
    print(f"{path}: {len(REQUIRED_PREFIXES)} 个 API 前缀全部已代理")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
