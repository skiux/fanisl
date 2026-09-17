"""单元核查的 HTTP 接口（契约见 backend/api.md §5.6）。

走真正的 fanisl.main：要验的是中间件、登录判定、请求模型与 store 接在一起之后的行为。
TestClient 的 base_url 用 https——会话 cookie 带 Secure，http 下 httpx 不会存它。
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from fanisl.auth.passwords import hash_password
from fanisl.knowledge.models import KnowledgeUnit
from fanisl.knowledge.store import KnowledgeStore

ADMIN_PW = "admin-password-1"
MEMBER_PW = "member-password-1"


def _client() -> TestClient:
    """**不进 lifespan**（不写 `with`）：`main._lifespan` 退出时会关掉 runtime 的全局池，
    本次会话里之后再用到它们的用例都会 PoolClosed（与 test_auth.real_client 同一个坑）。"""
    from fanisl.main import app

    return TestClient(app, base_url="https://testserver")


def _logged_in(username: str, password: str) -> TestClient:
    c = _client()
    assert c.post("/auth/login", json={"username": username, "password": password}).status_code == 200
    return c


@pytest.fixture
def admin(auth_store):
    auth_store.create_user("root", hash_password(ADMIN_PW), role="admin")
    return _logged_in("root", ADMIN_PW)


@pytest.fixture
def member(auth_store):
    auth_store.create_user("bob", hash_password(MEMBER_PW))
    return _logged_in("bob", MEMBER_PW)


@pytest.fixture
def unit_id(pool):
    ks = KnowledgeStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE creators, creator_handles, contents, extraction_runs, knowledge_units, "
                     "claim_scores, spot_checks, keyframes, unit_reviews, unit_review_messages, "
                     "unit_amendments RESTART IDENTITY CASCADE")
    creator = ks.ensure_creator("测试信源")
    content_id, _ = ks.upsert_content(
        creator, platform="manual", url="https://example.test/review-api", content_type="article",
        title="核查接口", published_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        raw="算力定价终局是按结果收费。")
    unit = KnowledgeUnit(kind="concept", quote="算力定价终局是按结果收费", tags=["nvda"],
                         payload={"canonical_statement": "算力定价终局是按结果收费",
                                  "category": "market_structure"})
    return ks.record_extraction(content_id, extractor_version="v2", model="test", units=[unit])[0]


def _review_count(pool) -> int:
    with pool.connection() as conn:
        return conn.execute("SELECT count(*) AS n FROM unit_reviews").fetchone()["n"]


def test_everything_requires_login(unit_id):
    c = _client()
    assert c.get(f"/knowledge/units/{unit_id}/reviews").status_code == 401
    assert c.get("/knowledge/reviews").status_code == 401
    assert c.post(f"/knowledge/units/{unit_id}/reviews",
                  json={"category": "quote", "body": "x"}).status_code == 401
    assert c.post("/knowledge/reviews/1/messages", json={"body": "x"}).status_code == 401
    assert c.post("/knowledge/reviews/1/close").status_code == 401


def test_member_can_do_everything_an_admin_can(member, unit_id):
    """知识站不分角色（根 AGENTS.md §1）：成员能提交、回复、关闭，作者同样取自会话。
    2026-09-17 之前这三个写接口要求管理员，这条测试原本断言成员拿 403。"""
    r = member.post(f"/knowledge/units/{unit_id}/reviews",
                    json={"category": "quote", "body": "断章取义", "created_by": "root"})
    assert r.status_code == 201 and r.json()["created_by"] == "bob"
    rid = r.json()["id"]

    r = member.post(f"/knowledge/reviews/{rid}/messages", json={"body": "补充依据"})
    assert r.status_code == 200 and r.json()["messages"][-1]["author"] == "bob"
    r = member.post(f"/knowledge/reviews/{rid}/close")
    assert r.status_code == 200 and r.json()["status"] == "closed"
    # 结构不对仍由 FastAPI 拦下
    assert member.post(f"/knowledge/units/{unit_id}/reviews", json={}).status_code == 422


def test_admin_submits_and_the_author_comes_from_the_session(admin, unit_id):
    r = admin.post(f"/knowledge/units/{unit_id}/reviews", json={
        "category": "grade", "body": "这条应该是 B 不是 A",
        # 请求体里自称是谁一律不认
        "author": "claude-session", "created_by": "someone-else", "role": "extractor"})
    assert r.status_code == 201
    review = r.json()
    assert review["status"] == "open" and review["created_by"] == "root"
    assert [(m["role"], m["author"]) for m in review["messages"]] == [("reviewer", "root")]

    assert [x["id"] for x in admin.get(f"/knowledge/units/{unit_id}/reviews").json()] == [review["id"]]
    queue = admin.get("/knowledge/reviews", params={"status": "open"}).json()
    assert [(x["id"], x["n_messages"]) for x in queue] == [(review["id"], 1)]


def test_the_site_cannot_speak_as_the_extractor(admin, unit_id):
    """答复只走知识席位的 CLI。站上回复时伪造 role / resolution，落库的仍是一条 reviewer 消息；
    路由表里也没有答复接口。"""
    rid = admin.post(f"/knowledge/units/{unit_id}/reviews",
                     json={"category": "quote", "body": "断章取义"}).json()["id"]
    r = admin.post(f"/knowledge/reviews/{rid}/messages", json={
        "body": "补充说明", "role": "extractor", "author": "claude-session",
        "resolution": {"outcome": "fixed", "root_cause": "x", "sweep": "y"}})
    assert r.status_code == 200
    last = r.json()["messages"][-1]
    assert (last["role"], last["author"], last["resolution"]) == ("reviewer", "root", None)

    from fanisl.main import app

    writes = sorted((method, route.path) for route in app.routes
                    if "review" in getattr(route, "path", "")
                    for method in route.methods - {"GET", "HEAD"})
    assert writes == [("POST", "/knowledge/reviews/{review_id}/close"),
                      ("POST", "/knowledge/reviews/{review_id}/messages"),
                      ("POST", "/knowledge/units/{unit_id}/reviews")]


def test_reply_reopens_an_answered_review_and_closing_twice_conflicts(admin, unit_id):
    from fanisl.main import knowledge_store

    rid = admin.post(f"/knowledge/units/{unit_id}/reviews",
                     json={"category": "statement", "body": "结论加了原文没有的推论"}).json()["id"]
    # 答复只能走 CLI 那条路（store.answer_review），站上没有
    knowledge_store.answer_review(rid, body="维持原判：原文紧接着就是这句", outcome="no_change",
                                  author="claude-session")
    assert [x["id"] for x in admin.get("/knowledge/reviews", params={"status": "answered"}).json()] == [rid]

    reopened = admin.post(f"/knowledge/reviews/{rid}/messages", json={"body": "不同意，理由如下"})
    assert reopened.status_code == 200 and reopened.json()["status"] == "open"

    closed = admin.post(f"/knowledge/reviews/{rid}/close")
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed" and closed.json()["closed_at"] is not None
    again = admin.post(f"/knowledge/reviews/{rid}/close")
    assert again.status_code == 409 and "已经关闭" in again.json()["detail"]


def test_store_errors_map_to_400_and_404(admin, unit_id, pool):
    r = admin.post(f"/knowledge/units/{unit_id}/reviews", json={"category": "nonsense", "body": "x"})
    assert r.status_code == 400 and "category" in r.json()["detail"]
    assert admin.post(f"/knowledge/units/{unit_id}/reviews",
                      json={"category": "quote", "body": "   "}).status_code == 400
    assert admin.post(f"/knowledge/units/{unit_id}/reviews",
                      json={"category": "quote", "body": "长" * 4001}).status_code == 400
    assert admin.get("/knowledge/reviews", params={"status": "pending"}).status_code == 400

    r = admin.post("/knowledge/units/999999/reviews", json={"category": "quote", "body": "x"})
    assert r.status_code == 404 and "不存在" in r.json()["detail"]
    assert admin.post("/knowledge/reviews/999999/messages", json={"body": "x"}).status_code == 404
    assert admin.post("/knowledge/reviews/999999/close").status_code == 404

    # 结构不对（缺字段）由 FastAPI 在更前面拦下，不进 store
    assert admin.post(f"/knowledge/units/{unit_id}/reviews", json={"body": "x"}).status_code == 422
    assert _review_count(pool) == 0
