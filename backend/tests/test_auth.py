"""登录与用户管理。

这一组**必须走 HTTP**（不像其他测试直接调 handler 函数）：要验的东西大半在中间件里，
而中间件只在 ASGI 栈里跑。TestClient 的 base_url 用 https —— cookie 带 Secure，
httpx 在 http 下根本不会存它，用 http 测等于把生产配置绕过去了。
"""

from datetime import timedelta

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from analyzer.auth import routes as auth_routes
from analyzer.auth.passwords import hash_password, needs_rehash, verify_password
from analyzer.auth.session import AuthMiddleware, client_ip, is_public
from analyzer.auth.store import UserExists, normalize_username
from analyzer.runtime import settings

ADMIN_PW = "admin-password-1"
MEMBER_PW = "member-password-1"


@pytest.fixture
def app(auth_store):
    """一个最小 app：一条受保护路由 + 一条公开路由 + 真正的鉴权中间件与路由组。

    不用 analyzer.main：那个 app 会把 62 条业务路由和它们的依赖一起拖进来，
    而这里要验的只是"门"。门是同一扇——同样的中间件、同样的 store。
    """
    api = FastAPI()
    api.include_router(auth_routes.build_router(auth_store, settings))

    @api.get("/protected")
    def protected(request: Request):
        return {"who": request.state.user["username"]}

    @api.get("/health")
    def health():
        return {"status": "ok"}

    api.add_middleware(AuthMiddleware, store=auth_store,
                       cookie_name=settings.auth_cookie_name,
                       idle_days=settings.auth_idle_days, enabled=True)
    return api


@pytest.fixture
def client(app):
    with TestClient(app, base_url="https://testserver") as c:
        yield c


@pytest.fixture
def admin(auth_store):
    return auth_store.create_user("root", hash_password(ADMIN_PW), role="admin",
                                  display_name="管理员")


@pytest.fixture
def member(auth_store):
    return auth_store.create_user("bob", hash_password(MEMBER_PW))


def login(client, username, password):
    return client.post("/auth/login", json={"username": username, "password": password})


# --- 门本身 ---------------------------------------------------------------

def test_protected_route_requires_login(client):
    r = client.get("/protected")
    assert r.status_code == 401
    assert "未登录" in r.json()["detail"]


def test_health_is_public(client):
    # auto-update.sh 靠它判断重启后服务是否活着；挡了它每次部署都会被判失败并回滚
    assert client.get("/health").status_code == 200


def test_public_allowlist_is_exactly_three_paths():
    """白名单是安全边界，改动必须是有意的——加一条就要改这个断言。"""
    for path in ("/health", "/auth/login", "/auth/logout"):
        assert is_public(path)
    for path in ("/auth/me", "/auth/password", "/auth/sessions",
                 "/admin/users", "/chat", "/knowledge/units", "/", "/healthz"):
        assert not is_public(path)


def test_new_routes_are_protected_by_default(app, client, admin):
    """中间件是默认拒绝：后加的路由不必做任何事就受保护。"""
    @app.get("/some-route-added-later")
    def later():
        return {"ok": True}

    assert client.get("/some-route-added-later").status_code == 401
    login(client, "root", ADMIN_PW)
    assert client.get("/some-route-added-later").status_code == 200


def test_auth_can_be_disabled_for_emergency(auth_store):
    api = FastAPI()

    @api.get("/protected")
    def protected():
        return {"ok": True}

    api.add_middleware(AuthMiddleware, store=auth_store,
                       cookie_name=settings.auth_cookie_name,
                       idle_days=settings.auth_idle_days, enabled=False)
    with TestClient(api, base_url="https://testserver") as c:
        assert c.get("/protected").status_code == 200


# --- 登录 -----------------------------------------------------------------

def test_login_sets_cookie_and_grants_access(client, admin):
    r = login(client, "root", ADMIN_PW)
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "root"
    assert "password_hash" not in r.text

    cookie = r.cookies.get(settings.auth_cookie_name)
    assert cookie
    set_cookie = r.headers["set-cookie"]
    assert "HttpOnly" in set_cookie          # JS 读不到
    assert "Secure" in set_cookie            # 只走 HTTPS
    assert "samesite=lax" in set_cookie.lower()  # 跨站 POST 不带 cookie = CSRF 主防线

    assert client.get("/protected").json() == {"who": "root"}


def test_login_is_case_insensitive_on_username(client, admin):
    assert login(client, "ROOT", ADMIN_PW).status_code == 200


def test_wrong_password_and_unknown_user_give_the_same_answer(client, admin):
    a = login(client, "root", "wrong-password")
    b = login(client, "nobody-here", "wrong-password")
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]  # 不泄露用户名是否存在


def test_inactive_user_cannot_log_in(client, auth_store, member):
    auth_store.set_active(member["id"], False)
    assert login(client, "bob", MEMBER_PW).status_code == 401


def test_session_token_is_stored_hashed(client, auth_store, admin):
    r = login(client, "root", ADMIN_PW)
    token = r.cookies.get(settings.auth_cookie_name)
    with auth_store.pool.connection() as conn:
        rows = conn.execute("SELECT token_sha256 FROM sessions").fetchall()
    assert rows and all(row["token_sha256"] != token for row in rows)


def test_logout_kills_the_session(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/protected").status_code == 401


def test_logout_without_session_is_idempotent(client):
    assert client.post("/auth/logout").status_code == 200


def test_deactivating_a_user_invalidates_live_sessions(client, auth_store, member):
    login(client, "bob", MEMBER_PW)
    assert client.get("/protected").status_code == 200
    auth_store.set_active(member["id"], False)
    assert client.get("/protected").status_code == 401


def test_idle_session_expires(client, auth_store, admin):
    login(client, "root", ADMIN_PW)
    with auth_store.pool.connection() as conn:
        conn.execute("UPDATE sessions SET last_seen_at = now() - interval '400 days'")
    assert client.get("/protected").status_code == 401


def test_expired_session_expires(client, auth_store, admin):
    login(client, "root", ADMIN_PW)
    with auth_store.pool.connection() as conn:
        conn.execute("UPDATE sessions SET expires_at = now() - interval '1 second'")
    assert client.get("/protected").status_code == 401


def test_login_rate_limit_locks_out_after_repeated_failures(client, admin):
    for _ in range(settings.auth_max_fail_user):
        assert login(client, "root", "nope").status_code == 401
    r = login(client, "root", ADMIN_PW)   # 口令对了也进不去——已经被锁
    assert r.status_code == 429
    assert "分钟后再试" in r.json()["detail"]


def test_successful_login_resets_the_failure_counter(client, admin):
    for _ in range(settings.auth_max_fail_user - 1):
        login(client, "root", "nope")
    assert login(client, "root", ADMIN_PW).status_code == 200
    for _ in range(settings.auth_max_fail_user - 1):
        login(client, "root", "nope")
    assert login(client, "root", ADMIN_PW).status_code == 200


# --- 自己的账号 -----------------------------------------------------------

def test_me_returns_current_user(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.get("/auth/me").json()["user"]["role"] == "admin"


def test_change_password_requires_current_one(client, admin):
    login(client, "root", ADMIN_PW)
    r = client.post("/auth/password",
                    json={"current_password": "wrong", "new_password": "brand-new-pw-1"})
    assert r.status_code == 401


def test_change_password_enforces_min_length(client, admin):
    login(client, "root", ADMIN_PW)
    r = client.post("/auth/password",
                    json={"current_password": ADMIN_PW, "new_password": "short"})
    assert r.status_code == 400


def test_change_password_keeps_caller_logged_in_but_kills_other_sessions(
        client, app, auth_store, admin):
    login(client, "root", ADMIN_PW)
    with TestClient(app, base_url="https://testserver") as other:
        login(other, "root", ADMIN_PW)
        assert other.get("/protected").status_code == 200

        r = client.post("/auth/password",
                        json={"current_password": ADMIN_PW, "new_password": "brand-new-pw-1"})
        assert r.status_code == 200
        assert client.get("/protected").status_code == 200   # 自己还在
        assert other.get("/protected").status_code == 401    # 别处被踢

    assert login(client, "root", "brand-new-pw-1").status_code == 200


def test_revoke_all_my_sessions(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.get("/auth/sessions").json()
    assert client.request("DELETE", "/auth/sessions").json()["revoked"] >= 1
    assert client.get("/protected").status_code == 401


# --- 管理员 ---------------------------------------------------------------

def test_member_cannot_reach_admin_routes(client, member):
    login(client, "bob", MEMBER_PW)
    assert client.get("/admin/users").status_code == 403
    assert client.post("/admin/users",
                       json={"username": "eve", "password": "whatever-1234"}).status_code == 403


def test_admin_creates_lists_and_deletes_users(client, admin):
    login(client, "root", ADMIN_PW)
    r = client.post("/admin/users", json={"username": "Carol", "password": "carol-password-1",
                                          "display_name": "卡罗"})
    assert r.status_code == 201
    created = r.json()
    assert created["username"] == "carol"      # 归一成小写
    assert created["role"] == "member"
    assert "password_hash" not in r.text

    names = [u["username"] for u in client.get("/admin/users").json()]
    assert names == ["root", "carol"]

    assert client.delete(f"/admin/users/{created['id']}").status_code == 200
    assert [u["username"] for u in client.get("/admin/users").json()] == ["root"]


def test_admin_cannot_create_duplicate_username(client, admin, member):
    login(client, "root", ADMIN_PW)
    r = client.post("/admin/users", json={"username": "BOB", "password": "another-password-1"})
    assert r.status_code == 409


def test_admin_password_policy_and_username_charset(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.post("/admin/users",
                       json={"username": "dave", "password": "short"}).status_code == 400
    assert client.post("/admin/users",
                       json={"username": "王小明", "password": "long-enough-pw-1"}).status_code == 400


def test_admin_reset_password_kicks_the_user_out(client, app, auth_store, admin, member):
    with TestClient(app, base_url="https://testserver") as bob:
        login(bob, "bob", MEMBER_PW)
        assert bob.get("/protected").status_code == 200

        login(client, "root", ADMIN_PW)
        r = client.post(f"/admin/users/{member['id']}/password",
                        json={"new_password": "reset-password-1"})
        assert r.status_code == 200
        assert bob.get("/protected").status_code == 401

    with TestClient(app, base_url="https://testserver") as bob2:
        assert login(bob2, "bob", "reset-password-1").status_code == 200


def test_admin_can_promote_and_demote(client, auth_store, admin, member):
    login(client, "root", ADMIN_PW)
    r = client.patch(f"/admin/users/{member['id']}", json={"role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    r = client.patch(f"/admin/users/{member['id']}", json={"role": "member"})
    assert r.json()["role"] == "member"


def test_last_admin_is_protected(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.patch(f"/admin/users/{admin['id']}",
                        json={"role": "member"}).status_code == 409
    assert client.patch(f"/admin/users/{admin['id']}",
                        json={"is_active": False}).status_code == 409
    assert client.delete(f"/admin/users/{admin['id']}").status_code == 409


def test_admin_cannot_change_own_role_even_with_another_admin(client, auth_store, admin):
    """降级自己后果比停用自己更隐蔽：还能登录，但管理面没了，自己捞不回来。

    `test_last_admin_is_protected` 挡的是"最后一个管理员"这一条；这里另开一个管理员，
    让那条守卫失效，验的是"自己"这一条。
    """
    auth_store.create_user("root2", hash_password("second-admin-pw-1"), role="admin")
    login(client, "root", ADMIN_PW)
    r = client.patch(f"/admin/users/{admin['id']}", json={"role": "member"})
    assert r.status_code == 409 and "自己" in r.json()["detail"]
    assert auth_store.get(admin["id"])["role"] == "admin"
    # 改自己的显示名不受影响，只有角色被拦
    assert client.patch(f"/admin/users/{admin['id']}",
                        json={"display_name": "老板"}).status_code == 200
    # 把 role 原样传回来也不算改，不该拦
    assert client.patch(f"/admin/users/{admin['id']}",
                        json={"role": "admin"}).status_code == 200


def test_session_list_marks_the_current_one(client, app, admin):
    """同一台 nginx 后面，几台设备的出口 IP 常常一样——不标出来就分不清哪条是自己。"""
    login(client, "root", ADMIN_PW)
    with TestClient(app, base_url="https://testserver") as other:
        login(other, "root", ADMIN_PW)
        rows = client.get("/auth/sessions").json()
        assert len(rows) == 2
        assert [r["is_current"] for r in rows].count(True) == 1
        assert [r["is_current"] for r in other.get("/auth/sessions").json()].count(True) == 1
    # token 的散列不能出现在响应里
    assert not any("sha" in key or "token" in key for row in rows for key in row)


def test_admin_cannot_delete_self_even_with_another_admin(client, auth_store, admin):
    auth_store.create_user("root2", hash_password("second-admin-pw-1"), role="admin")
    login(client, "root", ADMIN_PW)
    assert client.delete(f"/admin/users/{admin['id']}").status_code == 409


def test_updating_display_name_does_not_kick_the_user(client, app, admin, member):
    with TestClient(app, base_url="https://testserver") as bob:
        login(bob, "bob", MEMBER_PW)
        login(client, "root", ADMIN_PW)
        r = client.patch(f"/admin/users/{member['id']}", json={"display_name": "鲍勃"})
        assert r.status_code == 200 and r.json()["display_name"] == "鲍勃"
        assert bob.get("/protected").status_code == 200


def test_role_change_forces_reauthentication(client, app, admin, member):
    with TestClient(app, base_url="https://testserver") as bob:
        login(bob, "bob", MEMBER_PW)
        login(client, "root", ADMIN_PW)
        client.patch(f"/admin/users/{member['id']}", json={"role": "admin"})
        # 权限变了，旧会话不能继续用——否则降级一个人之后他手里的 cookie 还是管理员
        assert bob.get("/protected").status_code == 401


def test_admin_routes_404_on_missing_user(client, admin):
    login(client, "root", ADMIN_PW)
    assert client.patch("/admin/users/99999", json={"role": "member"}).status_code == 404
    assert client.delete("/admin/users/99999").status_code == 404
    assert client.post("/admin/users/99999/password",
                       json={"new_password": "whatever-pw-1"}).status_code == 404


# --- 纯函数 ---------------------------------------------------------------

def test_password_hash_roundtrip_and_rehash_detection():
    h = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong", h)
    assert not verify_password("x", "garbage-not-a-hash")
    assert not needs_rehash(h)
    assert needs_rehash("bcrypt$2b$12$whatever")


def test_username_normalization():
    assert normalize_username("  Alice  ") == "alice"
    assert normalize_username("BOB") == "bob"


def test_client_ip_prefers_x_real_ip_and_ignores_forwarded_for():
    # X-Forwarded-For 可被客户端伪造并追加，用它做限速等于让攻击者自己选桶
    scope = {"headers": [(b"x-real-ip", b"203.0.113.7"),
                         (b"x-forwarded-for", b"1.2.3.4, 5.6.7.8")],
             "client": ("127.0.0.1", 12345)}
    assert client_ip(scope) == "203.0.113.7"
    assert client_ip({"headers": [(b"x-forwarded-for", b"1.2.3.4")],
                      "client": ("127.0.0.1", 1)}) == "127.0.0.1"


def test_duplicate_user_raises(auth_store):
    auth_store.create_user("dup", hash_password("pw"))
    with pytest.raises(UserExists):
        auth_store.create_user("DUP", hash_password("pw"))


def test_purge_helpers(auth_store, monkeypatch):
    u = auth_store.create_user("purge", hash_password("pw"))
    auth_store.create_session(u["id"], ttl=timedelta(days=-1))
    assert auth_store.purge_expired() == 1
    auth_store.record_attempt("purge", "1.1.1.1", False)
    assert auth_store.purge_attempts(timedelta(seconds=-1)) == 1


# --- 真正的 app：逐条路由核对 ---------------------------------------------
#
# 上面那些用的是最小 app，验的是"门"本身。这一节验的是"门装在了整栋楼上"：
# 把 analyzer.main 里注册的每一条路由都打一遍，逐条断言未登录时不可达。
# 将来有人新加路由、或不小心往白名单里塞东西，这里会红。

def _sample_path(path: str) -> str:
    """把 /knowledge/units/{unit_id} 这类占位符填成能构造请求的具体路径。"""
    out = []
    for seg in path.split("/"):
        out.append("1" if seg.startswith("{") and seg.endswith("}") else seg)
    return "/".join(out)


def _walk_routes(routes):
    """递归摊平路由表。

    FastAPI 0.141 的 `include_router` 不再把子路由并进 `app.routes`，而是塞一个
    `_IncludedRouter` 占位对象进去（子路由挂在它的 `original_router` 上）。
    只遍历 `app.routes` 会**静默漏掉**整个被包含的路由组——这条测试是安全断言，
    漏检等于假通过，所以必须往里走一层。
    """
    from starlette.routing import Route

    for route in routes:
        if isinstance(route, Route) and route.methods:
            yield route
        inner = getattr(route, "original_router", None) or getattr(route, "router", None)
        if inner is not None and hasattr(inner, "routes"):
            yield from _walk_routes(inner.routes)


@pytest.fixture(scope="module")
def real_client():
    from analyzer.main import app as real_app

    with TestClient(real_app, base_url="https://testserver") as c:
        yield c


def test_route_walker_sees_included_routers():
    """守住上面那条递归：哪天 FastAPI 又换了内部表示，这里先红。"""
    from analyzer.main import app as real_app

    paths = {r.path for r in _walk_routes(real_app.routes)}
    assert "/auth/login" in paths, "没走进 include_router，下面的全量断言会假通过"
    assert "/admin/users" in paths
    assert "/chat" in paths


def test_every_real_route_is_closed_without_login(real_client):
    from analyzer.main import app as real_app

    checked = 0
    for route in _walk_routes(real_app.routes):
        if is_public(route.path):
            continue
        method = next(iter(sorted(route.methods - {"HEAD", "OPTIONS"})), None)
        if method is None:
            continue
        r = real_client.request(method, _sample_path(route.path))
        assert r.status_code == 401, f"{method} {route.path} 未登录竟然返回 {r.status_code}"
        checked += 1

    # 别让这条测试因为路由被意外清空而"空跑通过"
    assert checked >= 70, f"只检了 {checked} 条路由，是不是路由表没装上？"


def test_real_app_health_and_docs(real_client):
    assert real_client.get("/health").status_code == 200
    # /docs 与 /openapi.json 会把整个接口面暴露出去，一并关在门内
    assert real_client.get("/openapi.json").status_code == 401
    assert real_client.get("/docs").status_code == 401


def test_chat_endpoints_are_closed(real_client):
    """/chat 同步调 Claude，敞开等于把 API 额度交给任何扫到这台机器的人。"""
    assert real_client.post("/chat", json={"message": "hi"}).status_code == 401
    assert real_client.post("/chat/stream", json={"message": "hi"}).status_code == 401


def test_real_app_login_flow_works(real_client, auth_store):
    """端到端过一遍真 app：登录 → 访问受保护接口 → 退出 → 再访问被拒。

    上面的最小 app 验的是中间件；这条验的是它确实接在了 analyzer.main 上、
    而且 include_router 的路由真的能响应。
    """
    auth_store.create_user("realadmin", hash_password(ADMIN_PW), role="admin")
    assert real_client.get("/watchlist").status_code == 401

    r = real_client.post("/auth/login",
                         json={"username": "realadmin", "password": ADMIN_PW})
    assert r.status_code == 200
    assert real_client.get("/auth/me").json()["user"]["username"] == "realadmin"
    assert real_client.get("/metrics/catalog").status_code == 200

    real_client.post("/auth/logout")
    assert real_client.get("/metrics/catalog").status_code == 401


def test_inactive_admin_does_not_block_operations_on_itself(client, auth_store, admin):
    """已停用的管理员账号不该被"最后一个管理员"这条规则挡住。

    停用的管理员不在岗，`count_active_admins()` 本来就不数他；若只看 role 不看
    is_active，就会出现"唯一在岗管理员想删掉一个早已停用的旧管理员账号，被拒"。
    """
    old = auth_store.create_user("oldadmin", hash_password("old-admin-pw-1"), role="admin")
    auth_store.set_active(old["id"], False)
    login(client, "root", ADMIN_PW)
    assert store_count(auth_store) == 1
    assert client.delete(f"/admin/users/{old['id']}").status_code == 200


def store_count(auth_store):
    return auth_store.count_active_admins()


def test_demoting_an_inactive_admin_is_allowed(client, auth_store, admin):
    old = auth_store.create_user("oldadmin2", hash_password("old-admin-pw-1"), role="admin")
    auth_store.set_active(old["id"], False)
    login(client, "root", ADMIN_PW)
    r = client.patch(f"/admin/users/{old['id']}", json={"role": "member"})
    assert r.status_code == 200 and r.json()["role"] == "member"


def test_auth_disabled_also_makes_me_work(auth_store):
    """关掉鉴权要**整套**生效，不能只放行中间件。

    只放行的话 `/auth/me` 仍然 401（它读 request.state.user），于是两个前端都卡在
    登录页——而关掉鉴权的本意正是不需要登录。开关半生效比不开更难查。
    """
    api = FastAPI()
    api.include_router(auth_routes.build_router(auth_store, settings))

    @api.get("/protected")
    def protected(request: Request):
        return {"who": request.state.user["username"]}

    api.add_middleware(AuthMiddleware, store=auth_store,
                       cookie_name=settings.auth_cookie_name,
                       idle_days=settings.auth_idle_days, enabled=False)
    with TestClient(api, base_url="https://testserver") as c:
        assert c.get("/protected").status_code == 200
        me = c.get("/auth/me")
        assert me.status_code == 200
        user = me.json()["user"]
        # 顶栏上要一眼看出这不是真登录
        assert user["display_name"] == "鉴权已关闭"
        assert user["role"] == "admin"      # 关了鉴权本来就什么都能做


def test_login_response_reports_this_login_not_the_previous_one(client, admin):
    """登录响应里的 last_login_at 必须是**这一次**。

    mark_login 之前读到的那行还带着上一次的值，直接回它的话，首次登录后界面上
    会显示"从未登录"——数字自相矛盾，而且只在第一次登录时看得见。
    """
    assert admin["last_login_at"] is None
    body = login(client, "root", ADMIN_PW).json()
    assert body["user"]["last_login_at"] is not None
    assert client.get("/auth/me").json()["user"]["last_login_at"] == body["user"]["last_login_at"]


def test_public_health_endpoint_discloses_nothing_beyond_liveness(real_client):
    """/health 是全站唯一不需要登录的数据端点，回什么都等于公开。

    它曾经回 model 与 exchange——没有调用方读（auto-update.sh 只看状态码），
    却把"用哪个 Claude 模型、连哪个交易所"送给任何扫到这台机器的人。
    """
    body = real_client.get("/health").json()
    assert body == {"status": "ok"}


# --- 成员的数据上限 --------------------------------------------------------

def test_member_data_is_clipped_to_90_days_on_the_server(auth_store):
    """成员只能看 90 天以内，**这条必须在服务端做**。

    前端把数字藏起来不算数：接口原样返回的话，任何人打开开发者工具都能看到全部历史。
    """
    from analyzer.main import _clip_for_member, MEMBER_MAX_DAYS

    class Req:
        class state:
            user = None

    snapshot = {"pnl": {
        "daily": [{"date": f"d{i}", "realized_usd": 0.0, "traded": False}
                  for i in range(400)],
        "realized": {"spot_usd": 1234.5, "spot_scope": "全部成交历史",
                     "futures_usd": 10.0, "futures_scope": "最近 90 天"},
    }}

    member = Req()
    member.state.user = {"role": "member"}
    out = _clip_for_member(snapshot, member)
    assert len(out["pnl"]["daily"]) == MEMBER_MAX_DAYS
    assert out["pnl"]["daily"][-1]["date"] == "d399"      # 留最近的，不是最早的
    # 现货已实现是全历史的，成员留空——给一个"其实是全历史"的数才是骗人
    assert out["pnl"]["realized"]["spot_usd"] is None
    assert out["pnl"]["realized"]["futures_usd"] == 10.0  # 合约本来就只有 90 天


def test_admin_data_is_not_clipped(auth_store):
    from analyzer.main import _clip_for_member

    class Req:
        class state:
            user = {"role": "admin"}

    snapshot = {"pnl": {"daily": [{"date": f"d{i}"} for i in range(400)],
                        "realized": {"spot_usd": 1234.5}}}
    out = _clip_for_member(snapshot, Req())
    assert len(out["pnl"]["daily"]) == 400
    assert out["pnl"]["realized"]["spot_usd"] == 1234.5
