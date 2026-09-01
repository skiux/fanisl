"""会话中间件：整个 API 默认关门，只有白名单里的路径放行。

**为什么是中间件而不是每条路由挂 Depends**：这个 app 现在有 60+ 条路由，还会继续加。
靠"记得给新路由加一个依赖"来保证安全，等于把安全性寄托在不会忘这件事上——忘一次就是
一个洞，而且是静默的。中间件是**默认拒绝**：新加的路由自动受保护，要放行必须显式写进
白名单，方向反过来了。

**为什么是纯 ASGI 而不是 BaseHTTPMiddleware**：这个 app 有 SSE（`/chat/stream`）。
BaseHTTPMiddleware 会把响应包进 anyio 的任务组里，历史上与流式响应/客户端断连有过一堆
边角问题。纯 ASGI 中间件只在请求进来时看一眼 cookie，之后原样透传，流式不受影响。

**为什么把库查询丢到线程池**：中间件是 async 的，而 psycopg 的池是同步阻塞的。直接调
会占住事件循环——单 worker 下所有请求跟着一起卡。FastAPI 对同步 `def` 路由本来就是丢
线程池，这里保持一致。
"""

from __future__ import annotations

from datetime import timedelta

import anyio
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .store import UserStore

# 鉴权关闭时注入的占位用户。
#
# 只把中间件放行是不够的：`/auth/me` 仍然会 401（它读的是 request.state.user），
# 于是两个前端都卡在登录页——而关掉鉴权的本意正是不需要登录。开关要么整套生效，
# 要么别开。display_name 写明"鉴权已关闭"，好让它在顶栏上一眼就能看出不是真登录。
DISABLED_USER = {
    "id": 0,
    "username": "(auth-disabled)",
    "role": "admin",
    "display_name": "鉴权已关闭",
    "is_active": True,
    "created_at": None,
    "updated_at": None,
    "last_login_at": None,
}

# 未登录也必须可达的路径。清单**只有三条**，加之前先想清楚为什么。
#   /health       探针。auto-update.sh 重启后靠它判断服务活没活（deploy/auto-update.sh:60），
#                 挡了它自动更新会把每次正常部署都判成失败并回滚。
#   /auth/login   登录本身。
#   /auth/logout  退出。做成公开是为了幂等——会话已经失效时再点一次退出不该报错。
# `/auth/me`、`/auth/password` 等**不在**清单里：未登录时由中间件回 401，
# 前端正是靠这个 401 决定跳登录页。
_PUBLIC_EXACT = frozenset({"/health", "/auth/login", "/auth/logout"})


def is_public(path: str) -> bool:
    return path in _PUBLIC_EXACT


def client_ip(scope: Scope) -> str:
    """取真实来源 IP。nginx 反代在前，client 永远是 127.0.0.1，得看 X-Real-IP。

    只认 X-Real-IP（nginx-fanisl.conf 里设了这一个），**不认 X-Forwarded-For**——
    后者可以被客户端伪造并追加，用它做限速等于让攻击者自己选桶。
    """
    headers = {k.decode("latin-1").lower(): v.decode("latin-1")
               for k, v in scope.get("headers", [])}
    return headers.get("x-real-ip") or (scope.get("client") or ("", 0))[0] or ""


def cookie_token(scope: Scope, name: str) -> str:
    """从 Cookie 头里取会话 token。自己解析而不是构造 Request，省一层对象。"""
    for key, value in scope.get("headers", []):
        if key != b"cookie":
            continue
        for part in value.decode("latin-1").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
    return ""


class AuthMiddleware:
    def __init__(self, app: ASGIApp, *, store: UserStore, cookie_name: str,
                 idle_days: int, enabled: bool = True) -> None:
        self.app = app
        self.store = store
        self.cookie_name = cookie_name
        self.idle_ttl = timedelta(days=idle_days)
        self.enabled = enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if not self.enabled:
            scope.setdefault("state", {})["user"] = DISABLED_USER
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        # CORS 预检不带 cookie，拦了它浏览器连真正的请求都发不出去
        if scope.get("method") == "OPTIONS" or is_public(path):
            await self.app(scope, receive, send)
            return

        token = cookie_token(scope, self.cookie_name)
        user = None
        if token:
            user = await anyio.to_thread.run_sync(
                lambda: self.store.resolve_session(token, idle_ttl=self.idle_ttl))

        if user is None:
            response = JSONResponse({"detail": "未登录或会话已过期"}, status_code=401)
            await response(scope, receive, send)
            return

        scope.setdefault("state", {})["user"] = user
        await self.app(scope, receive, send)
