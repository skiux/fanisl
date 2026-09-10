"""登录 / 会话 / 用户管理的 HTTP 路由。

分两组：
- `/auth/*` — 任何登录用户对自己做的事（登录、退出、看自己是谁、改自己的口令、
  管自己的会话）。
- `/admin/users*` — 只有管理员能做的事。角色判定在 `_require_admin` 里，
  不散在各个 handler。

**用户名不存在与口令错误返回同一个错误**，且都要走一次口令散列——否则响应时间的差异
就是一个可用的用户名枚举信道。
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..config import Settings
from .passwords import hash_password, needs_rehash, verify_password
from .session import client_ip
from .store import ROLES, UserExists, UserStore, normalize_username

# 用户名不存在时也要付出同样的计算代价，否则"这个用户名存在吗"可以用响应时间问出来。
# 这是一个真实存在、参数与线上一致的散列串（口令是随机的，没人知道）。
_DUMMY_HASH = hash_password("this-password-is-never-used-only-for-timing")

_GENERIC_LOGIN_ERROR = "用户名或口令不正确"


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    role: str = "member"
    display_name: str = ""


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    display_name: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=1, max_length=256)


def current_user(request: Request) -> dict:
    """中间件放行的请求一定带 user；取不到说明这条路由被错误地列进了公开清单。"""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    return user


def build_router(store: UserStore, settings: Settings) -> APIRouter:
    router = APIRouter()

    def _check_password_policy(password: str) -> None:
        if len(password) < settings.auth_min_password_len:
            raise HTTPException(
                status_code=400,
                detail=f"口令至少 {settings.auth_min_password_len} 位")

    def _require_admin(request: Request) -> dict:
        user = current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="需要管理员权限")
        return user

    def _set_cookie(response: Response, token: str) -> None:
        response.set_cookie(
            settings.auth_cookie_name, token,
            max_age=settings.auth_session_days * 86400,
            httponly=True,                      # JS 读不到，XSS 偷不走
            secure=settings.auth_cookie_secure,  # 只走 HTTPS
            samesite="lax",                     # 跨站 POST 不带 cookie = CSRF 的主要防线
            path="/",
        )

    # --- 自己 -------------------------------------------------------------

    @router.post("/auth/login")
    def login(req: LoginRequest, request: Request, response: Response) -> dict:
        ip = client_ip(request.scope)
        window = timedelta(minutes=settings.auth_login_window_min)
        by_user, by_ip = store.recent_failures(req.username, ip, window)
        if by_user >= settings.auth_max_fail_user or by_ip >= settings.auth_max_fail_ip:
            raise HTTPException(
                status_code=429,
                detail=f"失败次数过多，请 {settings.auth_login_window_min} 分钟后再试")

        row = store.get_by_username(req.username)
        # 不存在的用户也跑一次散列：让两条路径耗时一致
        stored = row["password_hash"] if row else _DUMMY_HASH
        ok = verify_password(req.password, stored) and row is not None and row["is_active"]
        store.record_attempt(req.username, ip, ok)
        if not ok:
            raise HTTPException(status_code=401, detail=_GENERIC_LOGIN_ERROR)

        # 登录成功是唯一能拿到明文、可以顺手把旧参数升级到当前强度的时机
        if needs_rehash(stored):
            store.set_password(row["id"], hash_password(req.password), revoke_sessions=False)

        token = store.create_session(
            row["id"], ttl=timedelta(days=settings.auth_session_days),
            user_agent=request.headers.get("user-agent", ""), ip=ip)
        store.mark_login(row["id"])
        _set_cookie(response, token)
        # 重新读一次：row 是 mark_login **之前**读到的，直接回它的话
        # last_login_at 还是上一次登录的值——首次登录时界面上会显示"从未登录"
        return {"user": _public(store.get(row["id"]) or row)}

    @router.post("/auth/logout")
    def logout(request: Request, response: Response) -> dict:
        token = request.cookies.get(settings.auth_cookie_name, "")
        if token:
            store.delete_session(token)
        response.delete_cookie(settings.auth_cookie_name, path="/")
        return {"ok": True}

    @router.get("/auth/me")
    def me(request: Request) -> dict:
        return {"user": _public(current_user(request))}

    @router.post("/auth/password")
    def change_password(req: PasswordChangeRequest, request: Request,
                        response: Response) -> dict:
        user = current_user(request)
        row = store.get_by_username(user["username"])
        if row is None or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="当前口令不正确")
        _check_password_policy(req.new_password)
        # set_password 会撤掉全部会话（含当前这条），随即给自己发一张新的——
        # 改口令应当把别处的登录踢掉，但不该把改口令的人自己也踢出去。
        store.set_password(user["id"], hash_password(req.new_password))
        token = store.create_session(
            user["id"], ttl=timedelta(days=settings.auth_session_days),
            user_agent=request.headers.get("user-agent", ""),
            ip=client_ip(request.scope))
        _set_cookie(response, token)
        return {"ok": True}

    @router.get("/auth/sessions")
    def my_sessions(request: Request) -> list[dict]:
        return store.list_sessions(
            current_user(request)["id"],
            request.cookies.get(settings.auth_cookie_name, ""))

    @router.delete("/auth/sessions")
    def revoke_my_sessions(request: Request, response: Response) -> dict:
        user = current_user(request)
        n = store.delete_user_sessions(user["id"])
        response.delete_cookie(settings.auth_cookie_name, path="/")
        return {"revoked": n}

    # --- 管理员 -----------------------------------------------------------

    @router.get("/admin/users")
    def list_users(request: Request) -> list[dict]:
        _require_admin(request)
        return [_public(u) for u in store.list_users()]

    @router.post("/admin/users", status_code=201)
    def create_user(req: CreateUserRequest, request: Request) -> dict:
        _require_admin(request)
        if req.role not in ROLES:
            raise HTTPException(status_code=400, detail=f"角色只能是 {' / '.join(ROLES)}")
        _check_password_policy(req.password)
        name = normalize_username(req.username)
        if not name.isascii() or not name.replace("_", "").replace("-", "").isalnum():
            raise HTTPException(status_code=400,
                                detail="用户名只能用字母、数字、下划线和连字符")
        try:
            row = store.create_user(name, hash_password(req.password),
                                    role=req.role, display_name=req.display_name.strip())
        except UserExists:
            raise HTTPException(status_code=409, detail="用户名已存在") from None
        return _public(row)

    @router.patch("/admin/users/{user_id}")
    def update_user(user_id: int, req: UpdateUserRequest, request: Request) -> dict:
        admin = _require_admin(request)
        target = store.get(user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 最后一个管理员既不能被降级也不能被停用，否则谁也进不了管理面。
        # 只看**在岗**管理员：一个已停用的管理员账号不该挡住对它自己的操作。
        target_is_active_admin = target["role"] == "admin" and target["is_active"]
        losing_admin = target_is_active_admin and (
            (req.role is not None and req.role != "admin") or req.is_active is False
        )
        if losing_admin and store.count_active_admins() <= 1:
            raise HTTPException(status_code=409, detail="不能停用或降级最后一个管理员")
        if target["id"] == admin["id"]:
            # 停用自己会立刻把自己锁在门外；降级自己同样——只是后果更隐蔽：
            # 账号还能登录，但管理面没了，只能求另一个管理员把角色改回来。
            if req.is_active is False:
                raise HTTPException(status_code=409, detail="不能停用自己")
            if req.role is not None and req.role != admin["role"]:
                raise HTTPException(status_code=409, detail="不能改自己的角色")

        if req.role is not None:
            if req.role not in ROLES:
                raise HTTPException(status_code=400, detail=f"角色只能是 {' / '.join(ROLES)}")
            store.set_role(user_id, req.role)
        if req.is_active is not None:
            store.set_active(user_id, req.is_active)
        if req.display_name is not None:
            store.set_display_name(user_id, req.display_name.strip())
        return _public(store.get(user_id))

    @router.post("/admin/users/{user_id}/password")
    def reset_password(user_id: int, req: ResetPasswordRequest, request: Request) -> dict:
        _require_admin(request)
        if store.get(user_id) is None:
            raise HTTPException(status_code=404, detail="用户不存在")
        _check_password_policy(req.new_password)
        # 管理员重置口令 = 撤掉该用户全部会话，本人下次必须用新口令登录
        store.set_password(user_id, hash_password(req.new_password))
        return {"ok": True}

    @router.delete("/admin/users/{user_id}")
    def delete_user(user_id: int, request: Request) -> dict:
        admin = _require_admin(request)
        target = store.get(user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="用户不存在")
        if target["id"] == admin["id"]:
            raise HTTPException(status_code=409, detail="不能删除自己")
        if (target["role"] == "admin" and target["is_active"]
                and store.count_active_admins() <= 1):
            raise HTTPException(status_code=409, detail="不能删除最后一个管理员")
        store.delete_user(user_id)
        return {"ok": True}

    return router


def _public(row: dict) -> dict:
    """对外只给这几个字段——避免将来给 users 表加字段时把散列顺手漏出去。"""
    return {k: row[k] for k in ("id", "username", "role", "display_name", "is_active",
                                "created_at", "updated_at", "last_login_at") if k in row}
